import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnswerInput } from '../components/answers/AnswerInput';
import { Exhibit } from '../components/answers/Exhibit';
import { DistractorNotes, ReviewAnswer } from '../components/answers/ReviewAnswer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { IconBookmark, IconTimer, LogoMark } from '../components/Icons';
import { ErrorBox, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatClock, formatDuration } from '../lib/format';
import { startIndex } from '../lib/attempt';
import { initialResponse, isComplete, normalizeResponse, QUESTION_TYPE_LABEL, sameResponse } from '../lib/responses';
import type { AttemptQuestion, AttemptState, CertificationDetail, PracticeFeedback, Response, SaveAnswerResult } from '../lib/types';
import { useApi } from '../lib/useApi';

type Feedback = PracticeFeedback | { correct: boolean; explanation?: string };

function NavCell({
  q,
  n,
  current,
  clickable,
  onClick,
}: {
  q: AttemptQuestion;
  n: number;
  current: boolean;
  clickable: boolean;
  onClick: () => void;
}) {
  const answered = q.response !== null;
  const state = current ? 'en cours' : answered ? 'répondue' : 'non vue';
  const label = `Question ${n}, ${state}${q.flagged ? ', marquée pour révision' : ''}`;
  const cls = `relative flex h-11 items-center justify-center rounded font-mono text-[12px] font-medium ${
    current ? 'bg-chrome text-accent outline outline-2 outline-accent' : answered ? 'bg-[#1C3A4A] text-[#BDEFF6]' : 'bg-raised text-muted'
  }`;
  const dot = q.flagged && <span aria-hidden className="absolute right-1 top-1 h-[6px] w-[6px] rounded-full bg-warn" />;
  if (!clickable) {
    return (
      <span className={cls} aria-label={label} role="img" aria-current={current ? 'step' : undefined}>
        {n}
        {dot}
      </span>
    );
  }
  return (
    <button type="button" className={`${cls} hover:outline hover:outline-1 hover:outline-line2`} aria-label={label} aria-current={current ? 'step' : undefined} onClick={onClick}>
      {n}
      {dot}
    </button>
  );
}

export function AttemptPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const cert = useApi<CertificationDetail>('/certifications/ccna');
  const domainName = useMemo(
    () => new Map((cert.data?.certification.domains ?? []).map((d) => [d.code, d.name])),
    [cert.data],
  );

  const [attempt, setAttempt] = useState<AttemptState | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Response | null>>({});
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [finishing, setFinishing] = useState<'manual' | 'timeout' | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Temps passé par question (cumulé sur la session de navigateur).
  const seconds = useRef<Record<string, number>>({});
  const enteredAt = useRef(Date.now());
  const furthest = useRef(0);
  const finishingRef = useRef(false);

  const goResult = useCallback(() => navigate(`/tentatives/${id}/resultat`, { replace: true }), [id, navigate]);

  useEffect(() => {
    let cancelled = false;
    api<AttemptState>(`/attempts/${id}`)
      .then((a) => {
        if (cancelled) return;
        if (a.status !== 'in_progress') {
          goResult();
          return;
        }
        const start = startIndex(a);
        setAttempt(a);
        setIndex(start);
        furthest.current = Math.max(a.furthestPosition, start);
        setDrafts(Object.fromEntries(a.questions.map((q) => [q.id, initialResponse(q.body, q.response)])));
        setFeedback(
          Object.fromEntries(
            a.questions
              .filter((q) => q.isCorrect !== undefined)
              .map((q) => [q.id, { correct: q.isCorrect as boolean, ...(q.explanation ? { explanation: q.explanation } : {}) }]),
          ),
        );
        enteredAt.current = Date.now();
      })
      .catch((e: unknown) => !cancelled && setLoadError(e));
    return () => {
      cancelled = true;
    };
  }, [id, goResult]);

  const question = attempt?.questions[index] ?? null;
  const isPractice = attempt?.mode === 'practice';
  const deadline = attempt?.deadlineAt ? new Date(attempt.deadlineAt).getTime() : null;
  const remaining = deadline !== null ? Math.max(0, Math.round((deadline - now) / 1000)) : null;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const elapsedOn = useCallback((qid: string) => {
    return (seconds.current[qid] ?? 0) + (Date.now() - enteredAt.current) / 1000;
  }, []);

  const handleClosed = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && (e.code === 'attempt_closed' || e.code === 'attempt_expired')) {
        goResult();
        return true;
      }
      return false;
    },
    [goResult],
  );

  /** Enregistre la question courante (réponse si modifiée + temps passé). */
  const saveCurrent = useCallback(async (): Promise<SaveAnswerResult | null> => {
    if (!attempt || !question) return null;
    const draft = normalizeResponse(drafts[question.id] ?? null);
    const changed = !sameResponse(draft, question.response);
    const spent = Math.min(86_400, Math.round(elapsedOn(question.id)));
    const payload: { response?: Response | null; secondsSpent: number } = { secondsSpent: spent };
    if (changed) payload.response = draft;
    const res = await api<SaveAnswerResult>(`/attempts/${attempt.id}/answers/${question.id}`, { method: 'PUT', body: payload });
    seconds.current[question.id] = spent;
    enteredAt.current = Date.now();
    if (changed) {
      setAttempt((a) =>
        a ? { ...a, questions: a.questions.map((q) => (q.id === question.id ? { ...q, response: draft } : q)) } : a,
      );
      if (res.feedback) setFeedback((f) => ({ ...f, [question.id]: res.feedback as PracticeFeedback }));
      else if (draft === null) setFeedback((f) => {
        const { [question.id]: _, ...rest } = f;
        return rest;
      });
    }
    furthest.current = Math.max(furthest.current, question.position);
    return res;
  }, [attempt, question, drafts, elapsedOn]);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      setActionError(null);
      try {
        await fn();
      } catch (e) {
        if (!handleClosed(e)) setActionError(e);
      } finally {
        setBusy(false);
      }
    },
    [busy, handleClosed],
  );

  const goTo = useCallback(
    (i: number) =>
      run(async () => {
        if (!attempt || i < 0 || i >= attempt.questions.length || i === index) return;
        await saveCurrent();
        setIndex(i);
        enteredAt.current = Date.now();
        document.getElementById('enonce')?.focus();
      }),
    [run, attempt, index, saveCurrent],
  );

  const validate = () =>
    run(async () => {
      await saveCurrent();
    });

  const toggleFlag = () =>
    run(async () => {
      if (!attempt || !question) return;
      const flagged = !question.flagged;
      await api(`/attempts/${attempt.id}/answers/${question.id}`, { method: 'PUT', body: { flagged } });
      setAttempt((a) => (a ? { ...a, questions: a.questions.map((q) => (q.id === question.id ? { ...q, flagged } : q)) } : a));
    });

  const finish = useCallback(
    async (reason: 'manual' | 'timeout') => {
      if (!attempt || finishingRef.current) return;
      finishingRef.current = true;
      setFinishing(reason);
      setConfirmOpen(false);
      setActionError(null);
      try {
        try {
          await saveCurrent();
        } catch (e) {
          // Une réponse non enregistrée (délai dépassé…) ne doit pas bloquer la soumission.
          if (!(e instanceof ApiError)) throw e;
        }
        await api(`/attempts/${attempt.id}/submit`, { method: 'POST' });
        goResult();
      } catch (e) {
        if (handleClosed(e)) return;
        finishingRef.current = false;
        setFinishing(null);
        setActionError(e);
      }
    },
    [attempt, saveCurrent, goResult, handleClosed],
  );

  // Chrono à zéro : soumission automatique puis résultats.
  useEffect(() => {
    if (remaining === 0 && attempt && !finishingRef.current) void finish('timeout');
  }, [remaining, attempt, finish]);

  // Avertit avant de quitter la page avec une réponse non enregistrée.
  const dirty = !!question && !sameResponse(drafts[question.id] ?? null, question.response);
  useEffect(() => {
    if (!dirty || finishing) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty, finishing]);

  if (loadError) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-10">
        <ErrorBox error={loadError} title="Impossible de charger la session" />
        <Link to="/" className="font-mono text-[12px]">
          ← Tableau de bord
        </Link>
      </div>
    );
  }
  if (!attempt || !question) return <div className="mx-auto max-w-3xl px-6"><Spinner label="Chargement de la session…" /></div>;

  const total = attempt.questions.length;
  const n = index + 1;
  const answeredCount = attempt.questions.filter((q) => q.response !== null).length;
  const flaggedCount = attempt.questions.filter((q) => q.flagged).length;
  const draft = drafts[question.id] ?? null;
  const fb = feedback[question.id];
  const canGoBack = attempt.allowBackNavigation && index > 0;
  const low = remaining !== null && remaining < 600;
  const last = index === total - 1;
  const unanswered = attempt.questions.filter((q) => q.response === null && !(q.id === question.id && normalizeResponse(draft))).length;

  // Rythme (examen) : temps cible par question d'après la durée accordée.
  const pace = (() => {
    if (deadline === null) return null;
    const start = new Date(attempt.startedAt).getTime();
    const target = (deadline - start) / 1000 / total;
    const spent = (now - start) / 1000;
    const avg = answeredCount ? spent / answeredCount : null;
    const ahead = answeredCount * target - spent;
    return { target, avg, ahead };
  })();

  const title = isPractice ? 'Entraînement libre · CCNA 200-301' : 'Examen blanc · CCNA 200-301';
  const subtitle = isPractice
    ? 'CORRECTION IMMÉDIATE · NAVIGATION LIBRE'
    : `MODE JOUR J · ${attempt.allowBackNavigation ? 'RETOUR ARRIÈRE AUTORISÉ' : 'SANS RETOUR ARRIÈRE'} · SANS CORRECTION`;
  const bodyType = QUESTION_TYPE_LABEL[question.body.type];

  return (
    <div className="flex min-h-screen flex-col text-[15px] leading-normal">
      <header className="chrome sticky top-0 z-20 flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line px-4 py-2.5 sm:px-6">
        <div className="flex min-w-0 flex-[1_1_260px] items-center gap-3">
          <LogoMark size={24} className="shrink-0 text-accent" />
          <div className="min-w-0">
            <div className="truncate font-semibold">{title}</div>
            <div className="font-mono text-[11px] font-medium tracking-[0.6px] text-muted">{subtitle}</div>
          </div>
        </div>
        {remaining !== null && (
          <div
            role="timer"
            aria-label={`Temps restant ${formatDuration(remaining)}`}
            className="flex h-11 items-center gap-2.5 rounded-lg border px-4"
            style={{
              background: low ? 'rgba(255,107,94,0.1)' : '#101827',
              borderColor: low ? '#FF6B5E' : '#223049',
              color: low ? '#FF6B5E' : '#E7EDF6',
            }}
          >
            <IconTimer />
            <span className="font-mono text-[22px] font-semibold tracking-[1px] tabular" aria-hidden>
              {formatClock(remaining)}
            </span>
            {low && <span className="sr-only">Moins de 10 minutes</span>}
          </div>
        )}
        <div className="flex flex-[1_1_260px] items-center justify-end gap-4">
          <span className="font-mono text-[14px] font-medium" aria-live="polite">
            Question <span className="text-accent">{n}</span> / {total}
          </span>
        </div>
      </header>
      <div
        className="h-1 bg-raised"
        role="progressbar"
        aria-label="Progression"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={n}
      >
        <div className="h-full bg-accent transition-[width]" style={{ width: `${(n / total) * 100}%` }} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main className="flex min-w-0 flex-1 flex-col gap-[22px] px-4 py-6 sm:px-10 sm:py-8">
          <div className="flex flex-wrap gap-2">
            <span className="chip">{bodyType}</span>
            {question.body.exhibit && <span className="chip">EXHIBIT</span>}
            <span className="chip" title={domainName.get(question.domain)}>
              {question.domain} {domainName.get(question.domain)?.toUpperCase() ?? ''}
            </span>
            {question.flagged && <span className="chip !text-warn">MARQUÉE</span>}
          </div>

          <p id="enonce" tabIndex={-1} className="m-0 max-w-[820px] whitespace-pre-line text-[18px] leading-[1.55] outline-none">
            {question.body.stem}
            {question.body.type === 'mcq_multi' && (
              <span className="text-muted"> (Choisissez {question.body.selectCount} réponses.)</span>
            )}
          </p>

          {question.body.exhibit && <Exhibit text={question.body.exhibit} />}

          <AnswerInput
            key={question.id}
            body={question.body}
            value={draft}
            onChange={(r) => {
              setDrafts((d) => ({ ...d, [question.id]: r }));
              if (isPractice && fb) setFeedback(({ [question.id]: _, ...rest }) => rest);
            }}
            disabled={busy || finishing !== null}
          />

          {isPractice && fb && (
            <section
              aria-live="polite"
              aria-label="Correction"
              className="flex max-w-[900px] flex-col gap-3 rounded-xl border px-5 py-4"
              style={{
                borderColor: fb.correct ? 'rgba(61,220,151,.4)' : 'rgba(255,107,94,.45)',
                background: fb.correct ? 'rgba(61,220,151,.06)' : 'rgba(255,107,94,.06)',
              }}
            >
              <div className={`font-mono text-[13px] font-semibold ${fb.correct ? 'text-ok' : 'text-crit'}`}>
                {fb.correct ? '✓ BONNE RÉPONSE' : 'partial' in fb && fb.partial > 0 ? `✕ PARTIELLEMENT JUSTE · ${Math.round(fb.partial * 100)} %` : '✕ RÉPONSE INCORRECTE'}
              </div>
              {'key' in fb && !fb.correct && (
                <ReviewAnswer body={question.body} answerKey={fb.key} response={question.response} />
              )}
              {fb.explanation && (
                <div>
                  <div className="label-mono mb-1.5 tracking-[1px]">Explication</div>
                  <p className="m-0 whitespace-pre-line text-[14px] text-[#C9D4E5]">{fb.explanation}</p>
                </div>
              )}
              {'distractorNotes' in fb && Object.keys(fb.distractorNotes).length > 0 && (
                <div className="text-[14px]">
                  <div className="label-mono mb-1.5 tracking-[1px]">Pourquoi les autres réponses sont fausses</div>
                  <DistractorNotes body={question.body} notes={fb.distractorNotes} />
                </div>
              )}
            </section>
          )}

          {actionError != null && <ErrorBox error={actionError} />}
        </main>

        <aside
          aria-label="Navigateur de questions"
          className="flex flex-col gap-4 border-t border-line p-6 lg:w-[320px] lg:shrink-0 lg:border-l lg:border-t-0"
          style={{ background: 'rgba(8,12,21,.6)' }}
        >
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[14px] font-semibold">Navigation</h2>
            <span className="font-mono text-[12px] font-medium text-muted">
              {answeredCount} répondue{answeredCount > 1 ? 's' : ''} · {flaggedCount} marquée{flaggedCount > 1 ? 's' : ''}
            </span>
          </div>
          {!attempt.allowBackNavigation && (
            <p className="text-[12px] text-muted">Mode jour J : la grille indique l'état, sans retour possible.</p>
          )}
          <div className="grid max-h-[50vh] gap-1 overflow-y-auto p-0.5 [grid-template-columns:repeat(auto-fill,minmax(44px,1fr))]">
            {attempt.questions.map((q, i) => (
              <NavCell
                key={q.id}
                q={q}
                n={i + 1}
                current={i === index}
                clickable={attempt.allowBackNavigation && !busy}
                onClick={() => void goTo(i)}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 text-[12px] text-text2">
            <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-[3px] bg-[#1C3A4A]" />Répondue</span>
            <span className="flex items-center gap-2"><span className="box-border h-3 w-3 rounded-[3px] border border-line2 bg-raised" />Non vue</span>
            <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-[3px] bg-chrome outline outline-2 outline-accent" />En cours</span>
            <span className="flex items-center gap-2"><span className="mx-0.5 h-2 w-2 rounded-full bg-warn" />À revoir</span>
          </div>
          {pace && (
            <div className="mt-auto rounded-[10px] border border-[#223049] bg-surface p-3.5 text-[13px] text-text2">
              <div className="label-mono mb-1.5 tracking-[1px]">Rythme</div>
              {pace.avg === null ? (
                <>Cible <span className="font-mono text-text">{Math.round(pace.target)} s</span> / question.</>
              ) : (
                <>
                  Temps moyen <span className="font-mono text-text">{Math.round(pace.avg)} s</span> / question · cible{' '}
                  <span className="font-mono text-text">{Math.round(pace.target)} s</span>. Vous êtes{' '}
                  {pace.ahead >= 0 ? 'en avance' : 'en retard'} de{' '}
                  <span className={`font-mono ${pace.ahead >= 0 ? 'text-ok' : 'text-crit'}`}>{formatDuration(Math.abs(pace.ahead))}</span>.
                </>
              )}
            </div>
          )}
        </aside>
      </div>

      <footer className="chrome sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-line px-4 py-3 sm:px-6">
        <button
          type="button"
          aria-pressed={question.flagged}
          onClick={toggleFlag}
          disabled={busy || finishing !== null}
          className="btn"
          style={{
            background: question.flagged ? 'rgba(245,181,68,0.12)' : 'transparent',
            border: `1px solid ${question.flagged ? '#F5B544' : '#2B3B57'}`,
            color: question.flagged ? '#F5B544' : '#E7EDF6',
          }}
        >
          <IconBookmark />
          {question.flagged ? 'Marquée pour révision' : 'Marquer pour révision'}
        </button>
        <div className="flex-1" />
        <button type="button" className="btn-secondary" disabled={!canGoBack || busy || finishing !== null} onClick={() => void goTo(index - 1)}>
          ← Précédent
        </button>
        <button type="button" className="btn-secondary" disabled={busy || finishing !== null} onClick={() => setConfirmOpen(true)}>
          {isPractice ? "Terminer l'entraînement" : "Terminer l'examen"}
        </button>
        {isPractice && !fb && (
          <button
            type="button"
            className={last ? 'btn-primary' : 'btn-secondary'}
            disabled={busy || finishing !== null || !normalizeResponse(draft)}
            onClick={validate}
          >
            Valider
          </button>
        )}
        {!last && (
          <button
            type="button"
            className={isPractice && !fb ? 'btn-secondary' : 'btn-primary'}
            disabled={busy || finishing !== null}
            onClick={() => void goTo(index + 1)}
          >
            Suivant →
          </button>
        )}
        {last && (!isPractice || fb) && (
          <button type="button" className="btn-primary" disabled={busy || finishing !== null} onClick={() => setConfirmOpen(true)}>
            Terminer →
          </button>
        )}
      </footer>

      <ConfirmDialog
        open={confirmOpen}
        title={isPractice ? "Terminer l'entraînement ?" : "Terminer l'examen ?"}
        confirmLabel="Terminer et voir le résultat"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void finish('manual')}
      >
        <p>
          {unanswered > 0 ? (
            <>
              <strong className="text-warn">▲ {unanswered} question{unanswered > 1 ? 's' : ''} sans réponse</strong>
              {unanswered > 1 ? ' seront comptées fausses.' : ' sera comptée fausse.'}
            </>
          ) : (
            'Toutes les questions ont une réponse.'
          )}
          {flaggedCount > 0 && ` ${flaggedCount} question${flaggedCount > 1 ? 's' : ''} marquée${flaggedCount > 1 ? 's' : ''} pour révision.`}
        </p>
        {!isComplete(question.body, draft) && normalizeResponse(draft) && (
          <p className="mt-2 text-text2">La réponse en cours est incomplète mais sera enregistrée telle quelle.</p>
        )}
        <p className="mt-2 text-text2">Vous ne pourrez plus modifier vos réponses.</p>
      </ConfirmDialog>

      {finishing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm" role="alertdialog" aria-live="assertive" aria-label="Soumission">
          <div className="panel flex flex-col items-center gap-2 px-8 py-6 text-center">
            <div className="font-mono text-[13px] font-semibold text-accent">{finishing === 'timeout' ? 'TEMPS ÉCOULÉ' : 'SOUMISSION'}</div>
            <div>Correction en cours…</div>
          </div>
        </div>
      )}
    </div>
  );
}
