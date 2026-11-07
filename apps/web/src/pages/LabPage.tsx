import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { TimesChart } from '../components/charts';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LabTerminal } from '../components/LabTerminal';
import { ErrorBox, PageTitle, Spinner } from '../components/ui';
import { api, ApiError, errorMessage } from '../lib/api';
import { beatsTarget, COUNTDOWN_WARNING, countdownAnnouncement, MODE_LABEL, remainingSeconds } from '../lib/challenges';
import { clockOffset, resyncOffset, serverTime } from '../lib/clock';
import { formatClock, formatDateTime, formatDuration } from '../lib/format';
import type { LabAttemptState, LabCommandResult, LabDetail, LabHintResult, LabStep, LabTimes, PublicLab } from '../lib/types';
import { useApi } from '../lib/useApi';
import { ModePill } from './ChallengesPage';
import { DifficultyPill } from './LabsPage';

/** Racine des écrans d'un lab ou d'un challenge. */
const baseOf = (lab: Pick<PublicLab, 'kind'>) => (lab.kind === 'challenge' ? '/challenges' : '/labs/cli');
const isChallenge = (lab: Pick<PublicLab, 'kind'>) => lab.kind === 'challenge';

const CHRONO_KEY = 'examforge.labs.chrono';

function Panel({ title, aside, children, id }: { title: string; aside?: ReactNode; children: ReactNode; id?: string }) {
  const headingId = id ?? `p-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <section aria-labelledby={headingId} className="panel flex min-w-0 flex-col gap-3 px-5 py-[18px]">
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-base font-semibold">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Topology({ text }: { text: string }) {
  return (
    <figure className="m-0 overflow-hidden rounded-[10px] border border-[#223049]">
      <figcaption className="flex items-center gap-2 border-b border-[#223049] bg-surface px-3.5 py-2 font-mono text-[12px] font-medium text-muted">
        <span className="led h-2 w-2 rounded-full bg-accent" aria-hidden />
        Topologie
      </figcaption>
      <pre className="m-0 overflow-x-auto bg-[#070B13] px-4 py-3 font-mono text-[12.5px] leading-[1.55] text-[#C9D4E5]">{text}</pre>
    </figure>
  );
}

function Statement({ lab }: { lab: PublicLab }) {
  return (
    <Panel title="Énoncé" aside={<span className="font-mono text-[11px] text-muted">~{lab.estimatedMinutes} min</span>}>
      <p className="m-0 whitespace-pre-line text-[14.5px] leading-relaxed text-text2">{lab.statement}</p>
      <Topology text={lab.topology} />
    </Panel>
  );
}

function Eyebrow({ lab }: { lab: PublicLab }) {
  return (
    <>
      <span className="text-accent">●</span> {isChallenge(lab) ? 'CHALLENGE' : 'LAB CLI'} · {lab.subtopic} {lab.subtopicName.toUpperCase()}
    </>
  );
}

/** Classement personnel d'un challenge : meilleur temps et courbe des temps réussis. */
function PersonalTimes({ slug, refreshKey = 0 }: { slug: string; refreshKey?: number }) {
  const { data, error } = useApi<LabTimes>(`/labs/${encodeURIComponent(slug)}/times?r=${refreshKey}`);
  if (error != null) return <ErrorBox error={error} title="Temps indisponibles" />;
  if (!data) return <Spinner label="Chargement des temps…" />;
  const wins = data.times.filter((t) => t.success);
  return (
    <div className="flex flex-col gap-3">
      <dl className="m-0 grid grid-cols-2 gap-2 font-mono text-[12.5px]">
        <dt className="text-muted">Essais</dt>
        <dd className="m-0 text-text">{data.times.length}</dd>
        <dt className="text-muted">Réussis</dt>
        <dd className="m-0 text-text">{wins.length}</dd>
        <dt className="text-muted">Meilleur temps</dt>
        <dd className="m-0 text-text">
          {data.bestSeconds !== null ? formatDuration(data.bestSeconds) : '—'}
          {beatsTarget(data.bestSeconds, data.targetMinutes) && <span className="ml-1 text-ok">★ cible battue</span>}
        </dd>
      </dl>
      <TimesChart times={data} />
    </div>
  );
}

/** `/labs/cli/:slug` : présentation du lab, puis démarrage (ou reprise) d'une session. */
export function LabIntroPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi<LabDetail>(`/labs/${encodeURIComponent(slug)}`);
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<unknown>(null);

  const start = async () => {
    setBusy(true);
    setStartError(null);
    try {
      const state = await api<LabAttemptState>(`/labs/${encodeURIComponent(slug)}/attempts`, { method: 'POST' });
      navigate(`${baseOf(state.lab)}/sessions/${state.id}`);
    } catch (err) {
      setStartError(err);
      setBusy(false);
    }
  };

  if (loading && !data) return <Spinner label="Chargement du lab…" />;
  if (error != null) return <ErrorBox error={error} onRetry={reload} title="Lab indisponible" />;
  if (!data) return null;
  const { lab } = data;
  if (isChallenge(lab)) return <ChallengeIntro data={data} busy={busy} start={start} startError={startError} />;
  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-[22px]">
      <PageTitle eyebrow={<Eyebrow lab={lab} />} title={lab.title}>
        <DifficultyPill difficulty={lab.difficulty} />
      </PageTitle>
      <div className="grid min-w-0 gap-[22px] lg:grid-cols-[minmax(0,1fr)_340px]">
        <Statement lab={lab} />
        <div className="flex min-w-0 flex-col gap-[22px]">
          <Panel title="Objectifs" aside={<span className="font-mono text-[11px] text-muted">{lab.objectives.length}</span>}>
            <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-[14px] text-text2">
              {lab.objectives.map((o) => (
                <li key={o.id}>{o.description}</li>
              ))}
            </ol>
          </Panel>
          <Panel title="Votre parcours">
            <dl className="m-0 grid grid-cols-2 gap-2 font-mono text-[12.5px]">
              <dt className="text-muted">Sessions</dt>
              <dd className="m-0 text-text">{data.attempts}</dd>
              <dt className="text-muted">Réussi</dt>
              <dd className="m-0 text-text">{data.done ? '✓ oui' : 'pas encore'}</dd>
              <dt className="text-muted">Meilleur temps</dt>
              <dd className="m-0 text-text">{data.bestSeconds !== null ? formatDuration(data.bestSeconds) : '—'}</dd>
            </dl>
            <div className="flex flex-wrap gap-2">
              {data.inProgress && (
                <Link to={`/labs/cli/sessions/${data.inProgress}`} className="btn-primary">
                  Reprendre la session →
                </Link>
              )}
              <button type="button" className={data.inProgress ? 'btn-secondary' : 'btn-primary'} onClick={start} disabled={busy}>
                {busy ? 'Démarrage…' : data.inProgress ? 'Nouvelle session' : 'Démarrer le lab →'}
              </button>
            </div>
            {startError != null && <ErrorBox error={startError} />}
          </Panel>
          <Link to="/labs/cli" className="font-mono text-[12.5px]">
            ← Tous les labs
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Présentation d'un challenge : le défi (temps cible, échéance, mode), le classement personnel, le départ. */
function ChallengeIntro({ data, busy, start, startError }: { data: LabDetail; busy: boolean; start: () => void; startError: unknown }) {
  const { lab } = data;
  const info = lab.challenge!;
  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-[22px]">
      <PageTitle eyebrow={<Eyebrow lab={lab} />} title={lab.title}>
        <div className="flex flex-wrap gap-2">
          <ModePill mode={info.mode} />
          <DifficultyPill difficulty={lab.difficulty} />
        </div>
      </PageTitle>
      <div className="grid min-w-0 gap-[22px] lg:grid-cols-[minmax(0,1fr)_340px]">
        <Statement lab={lab} />
        <div className="flex min-w-0 flex-col gap-[22px]">
          <Panel title="Le défi">
            <dl className="m-0 grid grid-cols-2 gap-2 font-mono text-[12.5px]">
              <dt className="text-muted">Temps cible</dt>
              <dd className="m-0 text-text">{info.targetMinutes} min</dd>
              <dt className="text-muted">Échéance</dt>
              <dd className="m-0 text-text">{info.timeLimitMinutes} min</dd>
              <dt className="text-muted">Mode</dt>
              <dd className="m-0 text-text">{MODE_LABEL[info.mode]}</dd>
              <dt className="text-muted">Objectifs</dt>
              <dd className="m-0 text-text">{lab.objectives.length}</dd>
            </dl>
            <p className="m-0 text-[13.5px] text-text2">
              {info.mode === 'troubleshoot'
                ? 'La configuration de départ contient des pannes : trouvez-les et corrigez-les. '
                : 'Configurez les équipements selon l’énoncé. '}
              Aucun indice. Le chrono démarre au lancement et s’arrête dès que tous les objectifs sont atteints ; à l’échéance, le
              challenge se termine de lui-même.
            </p>
            <div className="flex flex-wrap gap-2">
              {data.inProgress && (
                <Link to={`/challenges/sessions/${data.inProgress}`} className="btn-primary">
                  Reprendre l’essai en cours →
                </Link>
              )}
              <button type="button" className={data.inProgress ? 'btn-secondary' : 'btn-primary'} onClick={start} disabled={busy}>
                {busy ? 'Démarrage…' : data.inProgress ? 'Nouveau départ' : 'Lancer le chrono →'}
              </button>
            </div>
            {data.inProgress && <p className="m-0 text-[12.5px] text-muted">Un nouveau départ abandonne l’essai en cours.</p>}
            {startError != null && <ErrorBox error={startError} />}
          </Panel>
          <Panel title="Objectifs" aside={<span className="font-mono text-[11px] text-muted">{lab.objectives.length}</span>}>
            <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-[14px] text-text2">
              {lab.objectives.map((o) => (
                <li key={o.id}>{o.description}</li>
              ))}
            </ol>
          </Panel>
          <Panel title="Vos temps">
            <PersonalTimes slug={lab.slug} />
          </Panel>
          <Link to="/challenges" className="font-mono text-[12.5px]">
            ← Tous les challenges
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Compte à rebours d'un challenge : affiché chaque seconde, annoncé seulement aux paliers (5 min, 1 min, 10 s). */
function Countdown({ remaining, onAnnounce }: { remaining: number; onAnnounce: (text: string) => void }) {
  const previous = useRef(remaining);
  useEffect(() => {
    const said = countdownAnnouncement(previous.current, remaining);
    previous.current = remaining;
    if (said) onAnnounce(said);
  }, [remaining, onAnnounce]);
  const warning = remaining <= COUNTDOWN_WARNING;
  return (
    <span
      role="timer"
      aria-live="off"
      aria-label={`Temps restant : ${formatClock(remaining)}`}
      className={`inline-flex min-h-[44px] items-center gap-2 rounded-lg border px-3 font-mono text-[15px] font-semibold tabular ${
        warning ? 'border-crit text-crit' : 'border-line2 text-text'
      }`}
      style={warning ? { background: 'rgba(255,107,94,.08)' } : undefined}
    >
      <span aria-hidden>{warning ? '⚠' : '⏳'}</span>
      {formatClock(remaining)}
    </span>
  );
}

/** `/labs/cli/sessions/:id` et `/challenges/sessions/:id` : la session (terminal, objectifs, indices), puis l'écran de fin. */
export function LabSessionPage() {
  const { id = '' } = useParams();
  const { data, error, loading, reload } = useApi<LabAttemptState>(`/lab-attempts/${encodeURIComponent(id)}`);
  if (loading && !data) return <Spinner label="Ouverture de la console…" />;
  if (error != null) return <ErrorBox error={error} onRetry={reload} title="Session indisponible" />;
  if (!data) return null;
  return <LabSession key={data.id} initial={data} />;
}

function useChrono(startedAt: string, initialServerNow: string, running: boolean) {
  const offset = useRef(clockOffset(initialServerNow, Date.now(), Date.now()));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  const resync = useCallback((serverNow: string, sentAt: number, receivedAt: number) => {
    offset.current = resyncOffset(offset.current, serverNow, sentAt, receivedAt);
  }, []);
  const elapsed = Math.max(0, Math.floor((serverTime(now, offset.current) - Date.parse(startedAt)) / 1000));
  return { elapsed, resync };
}

function useCountdown(deadlineAt: string | null, initialServerNow: string, running: boolean) {
  const offset = useRef(clockOffset(initialServerNow, Date.now(), Date.now()));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running || !deadlineAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running, deadlineAt]);
  const resync = useCallback((serverNow: string, sentAt: number, receivedAt: number) => {
    offset.current = resyncOffset(offset.current, serverNow, sentAt, receivedAt);
  }, []);
  const remaining = deadlineAt ? remainingSeconds(deadlineAt, serverTime(now, offset.current)) : null;
  return { remaining, resync };
}

function LabSession({ initial }: { initial: LabAttemptState }) {
  const navigate = useNavigate();
  const [state, setState] = useState(initial);
  const challenge = isChallenge(initial.lab);
  const base = baseOf(initial.lab);
  const [timesKey, setTimesKey] = useState(0);
  const [active, setActive] = useState(initial.devices[0]?.id ?? '');
  const [announce, setAnnounce] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [hintBusy, setHintBusy] = useState(false);
  const [showChrono, setShowChrono] = useState(() => localStorage.getItem(CHRONO_KEY) !== 'off');
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const finished = state.status === 'finished';
  const chrono = useChrono(state.startedAt, initial.serverNow, !finished && showChrono && !challenge);
  const countdown = useCountdown(state.deadlineAt, initial.serverNow, !finished && challenge);
  const elapsed = chrono.elapsed;
  const resync = useCallback(
    (serverNow: string, sentAt: number, receivedAt: number) => {
      chrono.resync(serverNow, sentAt, receivedAt);
      countdown.resync(serverNow, sentAt, receivedAt);
    },
    [chrono, countdown],
  );
  const timeUp = challenge && !finished && countdown.remaining === 0;
  const lab = state.lab;
  const achieved = useMemo(() => new Set(state.achieved), [state.achieved]);

  const toggleChrono = () => {
    setShowChrono((v) => {
      localStorage.setItem(CHRONO_KEY, v ? 'off' : 'on');
      return !v;
    });
  };

  /** Les envois sont joués l'un après l'autre, dans l'ordre de frappe. */
  const submit = (device: string, input: string): Promise<string | undefined> => {
    const run = queue.current.then(async () => {
      const sentAt = Date.now();
      try {
        const r = await api<LabCommandResult>(`/lab-attempts/${state.id}/commands`, { method: 'POST', body: { device, input } });
        resync(r.serverNow, sentAt, Date.now());
        setFailure(null);
        setState((s) => {
          const fresh = r.achieved.filter((o) => !s.achieved.includes(o));
          const names = fresh.map((o) => s.lab.objectives.find((x) => x.id === o)?.description).filter(Boolean);
          if (r.complete && !s.complete) setAnnounce('Tous les objectifs sont atteints. Vous pouvez terminer le lab.');
          else if (names.length) setAnnounce(`Objectif atteint : ${names.join(' ; ')}`);
          return {
            ...s,
            transcript: [...s.transcript, ...r.results],
            devices: s.devices.map((d) => ({ ...d, prompt: r.prompts[d.id] ?? d.prompt })),
            achieved: r.achieved,
            complete: r.complete,
            commandCount: r.commandCount,
          };
        });
        // Un challenge réussi s'arrête : l'écran de fin s'affiche avec la solution.
        if (r.finished) await reloadFinished('Challenge réussi : tous les objectifs sont atteints.');
        // Après `?`, la ligne revient dans la saisie, comme dans IOS.
        return r.results[r.results.length - 1]?.keep;
      } catch (err) {
        if (err instanceof ApiError && err.code === 'challenge_expired') {
          await reloadFinished('Temps écoulé : le challenge est terminé.');
          return undefined;
        }
        setFailure(errorMessage(err));
        return undefined;
      }
    });
    queue.current = run;
    return run;
  };

  /** Recharge l'état final (résultat, solution) et l'annonce. */
  const reloadFinished = useCallback(
    async (message: string) => {
      try {
        const r = await api<LabAttemptState>(`/lab-attempts/${initial.id}`);
        setState(r);
        setAnnounce(message);
        setTimesKey((k) => k + 1);
        window.scrollTo({ top: 0 });
      } catch (err) {
        setFailure(errorMessage(err));
      }
    },
    [initial.id],
  );

  // À l'échéance (heure du serveur), la session est close par le serveur ; on affiche l'écran de fin.
  useEffect(() => {
    if (!timeUp) return;
    const t = window.setTimeout(() => {
      void queue.current.then(async () => {
        try {
          const r = await api<LabAttemptState>(`/lab-attempts/${initial.id}/finish`, { method: 'POST' });
          setState(r);
          setAnnounce(r.result?.success ? 'Challenge réussi.' : 'Temps écoulé : le challenge est terminé.');
          setTimesKey((k) => k + 1);
          window.scrollTo({ top: 0 });
        } catch (err) {
          setFailure(errorMessage(err));
        }
      });
    }, 600);
    return () => window.clearTimeout(t);
  }, [timeUp, initial.id]);

  const hint = async () => {
    setHintBusy(true);
    try {
      const r = await api<LabHintResult>(`/lab-attempts/${state.id}/hint`, { method: 'POST' });
      setState((s) => ({ ...s, hints: r.hints, hintsUsed: r.hintsUsed }));
      setAnnounce(`Indice ${r.level} sur ${r.hintCount} : ${r.hint}`);
    } catch (err) {
      setFailure(errorMessage(err));
    } finally {
      setHintBusy(false);
    }
  };

  const finish = async () => {
    setConfirmFinish(false);
    setFinishing(true);
    try {
      await queue.current;
      const r = await api<LabAttemptState>(`/lab-attempts/${state.id}/finish`, { method: 'POST' });
      setState(r);
      setTimesKey((k) => k + 1);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setFailure(errorMessage(err));
    } finally {
      setFinishing(false);
    }
  };

  const restart = async () => {
    try {
      const r = await api<LabAttemptState>(`/labs/${encodeURIComponent(lab.slug)}/attempts`, { method: 'POST' });
      navigate(`${base}/sessions/${r.id}`);
    } catch (err) {
      setFailure(errorMessage(err));
    }
  };

  const onAnnounce = useCallback((text: string) => setAnnounce(text), []);

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-[22px]">
      <PageTitle eyebrow={<Eyebrow lab={lab} />} title={lab.title}>
        <div className="flex flex-wrap items-center gap-2">
          <DifficultyPill difficulty={lab.difficulty} />
          {!finished && challenge && countdown.remaining !== null && (
            <>
              <Countdown remaining={countdown.remaining} onAnnounce={onAnnounce} />
              <button type="button" className="btn-secondary btn-sm" onClick={() => setConfirmFinish(true)} disabled={finishing || timeUp}>
                {finishing ? 'Fin…' : 'Abandonner'}
              </button>
            </>
          )}
          {!finished && !challenge && (
            <>
              <button type="button" className="btn-secondary btn-sm" aria-pressed={showChrono} onClick={toggleChrono}>
                {showChrono ? (
                  <span className="font-mono tabular" aria-label={`Chrono : ${formatClock(elapsed)}`}>
                    ⏱ {formatClock(elapsed)}
                  </span>
                ) : (
                  'Afficher le chrono'
                )}
              </button>
              <button
                type="button"
                className={state.complete ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
                onClick={() => (state.complete ? void finish() : setConfirmFinish(true))}
                disabled={finishing}
              >
                {finishing ? 'Correction…' : 'Terminer le lab'}
              </button>
            </>
          )}
        </div>
      </PageTitle>

      <div role="status" aria-live="polite" className="sr-only">
        {announce}
      </div>
      {failure && (
        <div role="alert" className="rounded-[10px] border px-4 py-3 text-[13.5px] text-text2" style={{ borderColor: 'rgba(255,107,94,.45)', background: 'rgba(255,107,94,.07)' }}>
          {failure}
        </div>
      )}

      {finished && state.result && <LabResult state={state} onRestart={restart} timesKey={timesKey} />}

      <div className="grid min-w-0 gap-[22px] lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-[22px]">
          {!finished && <Statement lab={lab} />}
          {finished ? (
            <details className="panel px-5 py-4">
              <summary className="cursor-pointer font-semibold">Transcription de la session ({state.transcript.length} lignes)</summary>
              <div className="mt-3">
                <LabTerminal devices={state.devices} active={active} onActiveChange={setActive} transcript={state.transcript} onSubmit={submit} readOnly />
              </div>
            </details>
          ) : (
            <LabTerminal devices={state.devices} active={active} onActiveChange={setActive} transcript={state.transcript} onSubmit={submit} readOnly={timeUp} />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-[22px]">
          <Panel
            title="Objectifs"
            aside={
              <span className="font-mono text-[12px] text-text2">
                {state.achieved.length}/{lab.objectives.length}
              </span>
            }
          >
            <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Objectifs du lab">
              {lab.objectives.map((o) => {
                const ok = achieved.has(o.id);
                return (
                  <li key={o.id} className="flex items-start gap-2.5 text-[14px]">
                    <span
                      aria-hidden
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] ${
                        ok ? 'border-ok text-ok' : 'border-line2 text-dim'
                      }`}
                      style={ok ? { background: 'rgba(61,220,151,.12)' } : undefined}
                    >
                      {ok ? '✓' : ''}
                    </span>
                    <span className={ok ? 'text-text' : 'text-text2'}>
                      <span className="sr-only">{ok ? 'Atteint : ' : 'À faire : '}</span>
                      {o.description}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panel>
          {!finished && !challenge && (
            <Panel
              title="Indices"
              aside={
                <span className="font-mono text-[12px] text-text2">
                  {state.hintsUsed}/{lab.hintCount}
                </span>
              }
            >
              {state.hints.length === 0 && <p className="m-0 text-[13.5px] text-muted">Trois indices, du plus vague au plus précis. Ils sont comptés dans l’historique.</p>}
              <ol className="m-0 flex list-none flex-col gap-2 p-0">
                {state.hints.map((h, i) => (
                  <li key={i} className="rounded-lg border border-[#223049] bg-well px-3 py-2 text-[13.5px] text-text2">
                    <span className="label-mono mr-2 text-accent">#{i + 1}</span>
                    {h}
                  </li>
                ))}
              </ol>
              <button type="button" className="btn-secondary btn-sm self-start" onClick={hint} disabled={hintBusy || state.hintsUsed >= lab.hintCount}>
                {state.hintsUsed >= lab.hintCount ? 'Tous les indices sont affichés' : hintBusy ? 'Indice…' : `Indice ${state.hintsUsed + 1} sur ${lab.hintCount}`}
              </button>
            </Panel>
          )}
          <Link to={base} className="font-mono text-[12.5px]">
            {challenge ? '← Tous les challenges' : '← Tous les labs'}
          </Link>
        </div>
      </div>

      <ConfirmDialog
        open={confirmFinish}
        title={challenge ? 'Abandonner le challenge ?' : 'Terminer le lab ?'}
        confirmLabel={challenge ? 'Abandonner et voir la solution' : 'Terminer et voir la solution'}
        cancelLabel="Continuer"
        onConfirm={() => void finish()}
        onCancel={() => setConfirmFinish(false)}
      >
        {state.achieved.length}/{lab.objectives.length} objectifs atteints. {challenge ? 'L’essai' : 'La session'} sera compté
        {challenge ? '' : 'e'} comme non réussi{challenge ? '' : 'e'} et la solution sera affichée.
      </ConfirmDialog>
    </div>
  );
}

function Steps({ steps, label }: { steps: LabStep[]; label: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {steps.map((s, i) => (
        <figure key={`${s.device}-${i}`} className="m-0 overflow-hidden rounded-[10px] border border-[#223049]">
          <figcaption className="border-b border-[#223049] bg-surface px-3.5 py-2 font-mono text-[12px] font-medium text-muted">
            {label} · {s.device}
          </figcaption>
          <pre className="m-0 overflow-x-auto bg-[#070B13] px-4 py-3 font-mono text-[12.5px] leading-[1.6] text-[#C9D4E5]">
            {s.commands.length ? s.commands.map((c) => (c === '\x1a' ? '^Z' : c)).join('\n') : '(aucune commande acceptée)'}
          </pre>
        </figure>
      ))}
    </div>
  );
}

function LabResult({ state, onRestart, timesKey }: { state: LabAttemptState; onRestart: () => void; timesKey: number }) {
  const r = state.result!;
  const lab = state.lab;
  const challenge = isChallenge(lab);
  const title = challenge
    ? r.success
      ? 'Challenge réussi'
      : r.expired
        ? 'Temps écoulé'
        : 'Challenge abandonné'
    : r.success
      ? 'Lab réussi'
      : 'Lab terminé sans tous les objectifs';
  return (
    <section aria-labelledby="fin-h" className="panel-deep flex flex-col gap-5 px-5 py-6 sm:px-7">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="fin-h" className="text-xl font-semibold">
          {title}
        </h2>
        {r.success ? <span className="pill-ok">✓ RÉUSSI</span> : <span className="pill-crit">✕ NON RÉUSSI</span>}
        {challenge && r.success && beatsTarget(r.durationSeconds, r.targetMinutes) && <span className="pill-ok">★ TEMPS CIBLE BATTU</span>}
      </div>
      <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-[13px] sm:grid-cols-4">
        <div>
          <dt className="text-muted">Temps</dt>
          <dd className="m-0 text-text">{r.durationSeconds !== null ? formatDuration(r.durationSeconds) : '—'}</dd>
        </div>
        <div>
          <dt className="text-muted">Objectifs</dt>
          <dd className="m-0 text-text">
            {state.achieved.length}/{lab.objectives.length}
          </dd>
        </div>
        {challenge ? (
          <div>
            <dt className="text-muted">Temps cible</dt>
            <dd className="m-0 text-text">{r.targetMinutes !== null ? `${r.targetMinutes} min` : '—'}</dd>
          </div>
        ) : (
          <div>
            <dt className="text-muted">Indices</dt>
            <dd className="m-0 text-text">
              {state.hintsUsed}/{lab.hintCount}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-muted">Terminé le</dt>
          <dd className="m-0 text-text">{state.finishedAt ? formatDateTime(state.finishedAt) : '—'}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={onRestart}>
          {challenge ? 'Rejouer ce challenge' : 'Refaire ce lab'}
        </button>
        <Link to={baseOf(lab)} className="btn-secondary">
          {challenge ? 'Tous les challenges' : 'Tous les labs'}
        </Link>
      </div>

      {r.faults.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold">Pannes semées dans la configuration de départ</h3>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[14px] text-text2">
            {r.faults.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {challenge && (
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold">Vos temps</h3>
          <PersonalTimes slug={lab.slug} refreshKey={timesKey} />
        </div>
      )}

      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="text-base font-semibold">Votre configuration</h3>
          <p className="m-0 text-[13px] text-muted">Commandes acceptées par l’équipement, dans l’ordre de saisie.</p>
          <Steps steps={r.typed} label="Saisi" />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="text-base font-semibold">Solution</h3>
          <p className="m-0 text-[13px] text-muted">Une façon de faire ; les variantes équivalentes sont aussi acceptées.</p>
          <Steps steps={r.solution} label="Solution" />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-base font-semibold">Explication</h3>
        <p className="m-0 whitespace-pre-line text-[14.5px] leading-relaxed text-text2">{r.explanation}</p>
        <p className="m-0 font-mono text-[12px] text-muted">Référence : {r.reference}</p>
      </div>

      {r.variants.length > 0 && (
        <details>
          <summary className="cursor-pointer font-semibold">Variantes acceptées ({r.variants.length})</summary>
          <div className="mt-3 flex flex-col gap-4">
            {r.variants.map((v, i) => (
              <div key={i} className="flex flex-col gap-2">
                <p className="m-0 text-[13.5px] text-text2">{v.description}</p>
                <Steps steps={v.solution} label="Variante" />
              </div>
            ))}
          </div>
        </details>
      )}

      <details>
        <summary className="cursor-pointer font-semibold">Configuration finale des équipements</summary>
        <div className="mt-3 flex flex-col gap-3">
          {Object.entries(r.runningConfig).map(([device, text]) => (
            <figure key={device} className="m-0 overflow-hidden rounded-[10px] border border-[#223049]">
              <figcaption className="border-b border-[#223049] bg-surface px-3.5 py-2 font-mono text-[12px] font-medium text-muted">
                {device} · configuration courante
              </figcaption>
              <pre className="m-0 max-h-[420px] overflow-auto bg-[#070B13] px-4 py-3 font-mono text-[12.5px] leading-[1.6] text-[#C9D4E5]">{text}</pre>
            </figure>
          ))}
        </div>
      </details>

      {r.hints.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold">Indices du lab</h3>
          <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-[13.5px] text-text2">
            {r.hints.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

