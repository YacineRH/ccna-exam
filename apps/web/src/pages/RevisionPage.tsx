import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { WithCertification } from '../certification/CertificationContext';
import { AnswerInput } from '../components/answers/AnswerInput';
import { Exhibit } from '../components/answers/Exhibit';
import { DistractorNotes, ReviewAnswer } from '../components/answers/ReviewAnswer';
import { EmptyState, ErrorBox, PageTitle, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { certificationLabel } from '../lib/certification';
import { clockOffset } from '../lib/clock';
import { formatDate } from '../lib/format';
import { isComplete, QUESTION_TYPE_LABEL } from '../lib/responses';
import { dueLabel, LEITNER_BOXES } from '../lib/revision';
import type { CertificationSummary, RevisionAnswerResult, RevisionCard, RevisionDeck, RevisionOverview, RevisionSession, Response } from '../lib/types';
import { useApi } from '../lib/useApi';

export function RevisionPage() {
  return <WithCertification>{(c) => <Revision key={c.code} cert={c} />}</WithCertification>;
}

/** Démarre une session (toutes les cartes dues, ou un sous-thème) puis ouvre l'écran des cartes. */
export function useStartRevision(code: string) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const start = async (subtopic?: string) => {
    setBusy(subtopic ?? '*');
    setError(null);
    try {
      const s = await api<RevisionSession>('/revision/sessions', { method: 'POST', body: { certification: code, ...(subtopic ? { subtopic } : {}) } });
      navigate(`/revision/sessions/${s.id}`);
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  };
  return { start, busy, error };
}

function DeckRow({
  deck,
  code,
  onChanged,
  onStart,
  busy,
  now,
}: {
  deck: RevisionDeck;
  code: string;
  onChanged: () => void;
  onStart: (s: string) => void;
  busy: boolean;
  now: Date;
}) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const add = async () => {
    setAdding(true);
    setError(null);
    try {
      await api('/revision/decks', { method: 'POST', body: { certification: code, subtopic: deck.subtopic } });
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setAdding(false);
    }
  };
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border border-[#1A2539] bg-well px-4 py-3">
      <span className="min-w-0 flex-[1_1_220px]">
        <span className="block font-medium">{deck.subtopicName}</span>
        <span className="font-mono text-[12px] text-muted">
          {deck.subtopic} · {deck.enrolled ? `${deck.cards} cartes · ${deck.mastered} maîtrisée${deck.mastered > 1 ? 's' : ''}` : `${deck.available} cartes`}
        </span>
      </span>
      {deck.enrolled ? (
        <span className={deck.due ? 'pill-warn' : 'pill-ok'}>{deck.due ? `${deck.due} DUE${deck.due > 1 ? 'S' : ''}` : '✓ À JOUR'}</span>
      ) : (
        <span className="pill-neutral">NON AJOUTÉ</span>
      )}
      {deck.enrolled ? (
        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={!deck.due || busy}
          onClick={() => onStart(deck.subtopic)}
          aria-label={deck.due ? `Réviser les ${deck.due} cartes dues du paquet ${deck.subtopicName}` : `Paquet ${deck.subtopicName} à jour, prochaine carte ${dueLabel(deck.nextDueAt, now)}`}
        >
          {deck.due ? 'Réviser →' : dueLabel(deck.nextDueAt, now)}
        </button>
      ) : (
        <button type="button" className="btn-secondary btn-sm" onClick={add} disabled={adding} aria-label={`Ajouter le paquet ${deck.subtopicName}`}>
          {adding ? 'Ajout…' : 'Ajouter'}
        </button>
      )}
      {error != null && <ErrorBox error={error} />}
    </li>
  );
}

function Revision({ cert }: { cert: CertificationSummary }) {
  const { data, error, loading, reload } = useApi<RevisionOverview>(`/revision?certification=${encodeURIComponent(cert.code)}`);
  const { start, busy, error: startError } = useStartRevision(cert.code);
  // Les échéances se lisent à l'heure du serveur : une horloge de poste décalée ne change pas « demain ».
  const now = data ? new Date(Date.parse(data.serverNow)) : new Date();
  const enrolled = data?.decks.filter((d) => d.enrolled) ?? [];
  const others = data?.decks.filter((d) => !d.enrolled) ?? [];
  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-[22px]">
      <PageTitle
        eyebrow={
          <>
            <span className="text-accent">●</span> {certificationLabel(cert)} · RÉVISION ESPACÉE
          </>
        }
        title="À réviser aujourd’hui"
      />
      <p className="m-0 max-w-prose text-text2">
        Des paquets de 10 à 20 questions rapides par sous-thème. Chaque bonne réponse espace la carte (1, 2, 4… jusqu’à 64 jours) ; une
        erreur la ramène au lendemain. Correction immédiate, avec l’explication.
      </p>
      {loading && !data && <Spinner label="Chargement des cartes…" />}
      {error != null && <ErrorBox error={error} onRetry={reload} title="Révision indisponible" />}
      {data && (
        <>
          <section aria-labelledby="due-h" className="panel-deep flex flex-wrap items-center gap-5 px-5 py-5 sm:px-7">
            <div className="min-w-0 flex-[1_1_240px]">
              <h2 id="due-h" className="text-base font-semibold">
                Cartes dues
              </h2>
              <p className="m-0 mt-1 font-mono text-[40px] font-semibold leading-none tabular">{data.dueToday}</p>
              <p className="m-0 mt-2 text-[13px] text-muted">
                {data.totalCards === 0
                  ? 'Ajoutez un paquet ci-dessous pour commencer.'
                  : data.dueToday === 0
                    ? `Tout est à jour. Prochaine carte ${dueLabel(data.nextDueAt, now)}.`
                    : `Sur ${data.totalCards} cartes dans vos paquets.`}
              </p>
            </div>
            <button type="button" className="btn-primary" disabled={data.dueToday === 0 || busy !== null} onClick={() => void start()}>
              {busy === '*' ? 'Préparation…' : data.dueToday ? `Session rapide (${Math.min(20, data.dueToday)} cartes) →` : 'Rien à réviser'}
            </button>
            {startError != null && <ErrorBox error={startError} />}
          </section>

          <section aria-labelledby="decks-h" className="panel flex flex-col gap-4 px-4 py-5 sm:px-6">
            <h2 id="decks-h" className="text-base font-semibold">
              Vos paquets
            </h2>
            {enrolled.length === 0 ? (
              <EmptyState title="Aucun paquet pour l’instant.">Choisissez un sous-thème dans la liste ci-dessous : ses cartes seront dues tout de suite.</EmptyState>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {enrolled.map((d) => (
                  <DeckRow key={d.subtopic} deck={d} code={cert.code} onChanged={reload} onStart={(s) => void start(s)} busy={busy !== null} now={now} />
                ))}
              </ul>
            )}
          </section>

          {others.length > 0 && (
            <section aria-labelledby="more-h" className="panel flex flex-col gap-4 px-4 py-5 sm:px-6">
              <h2 id="more-h" className="text-base font-semibold">
                Paquets disponibles
              </h2>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {others.map((d) => (
                  <DeckRow key={d.subtopic} deck={d} code={cert.code} onChanged={reload} onStart={(s) => void start(s)} busy={busy !== null} now={now} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** `/revision/sessions/:id` : les cartes une par une, correction immédiate, nouvelle échéance. */
export function RevisionSessionPage() {
  const { id = '' } = useParams();
  const { data, error, loading, reload } = useApi<RevisionSession>(`/revision/sessions/${encodeURIComponent(id)}`);
  if (loading && !data) return <Spinner label="Ouverture de la session…" />;
  if (error != null) return <ErrorBox error={error} onRetry={reload} title="Session indisponible" />;
  if (!data) return null;
  return <Session key={data.id} initial={data} />;
}

function Session({ initial }: { initial: RevisionSession }) {
  const [cards, setCards] = useState<RevisionCard[]>(initial.cards);
  const firstOpen = initial.cards.findIndex((c) => c.answer === null);
  const [index, setIndex] = useState(firstOpen === -1 ? initial.cards.length : firstOpen);
  const [draft, setDraft] = useState<Response | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const stemRef = useRef<HTMLParagraphElement>(null);
  const offset = useRef(clockOffset(initial.serverNow, Date.now(), Date.now()));
  const serverNow = () => new Date(Date.now() + offset.current);
  const nextRef = useRef<HTMLButtonElement>(null);
  const card = cards[index];
  const answered = cards.filter((c) => c.answer !== null);
  const correct = answered.filter((c) => c.answer?.correct).length;
  const done = index >= cards.length;

  useEffect(() => {
    setDraft(null);
    stemRef.current?.focus();
  }, [index]);

  const submit = async () => {
    if (!card || !draft) return;
    setBusy(true);
    setFailure(null);
    try {
      const sentAt = Date.now();
      const r = await api<RevisionAnswerResult>(`/revision/sessions/${initial.id}/answers`, {
        method: 'POST',
        body: { questionId: card.questionId, response: draft, tzOffsetMinutes: new Date().getTimezoneOffset() },
      });
      offset.current = clockOffset(r.serverNow, sentAt, Date.now());
      setCards((all) =>
        all.map((c) => (c.questionId === card.questionId ? { ...c, answer: { response: draft, correct: r.correct, boxAfter: r.box, dueAfter: r.dueAt, feedback: r.feedback } } : c)),
      );
      window.setTimeout(() => nextRef.current?.focus(), 0);
    } catch (err) {
      setFailure(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-[22px]">
      <PageTitle
        eyebrow={
          <>
            <span className="text-accent">●</span> RÉVISION · {done ? 'TERMINÉE' : `CARTE ${index + 1} / ${cards.length}`}
          </>
        }
        title={done ? 'Session terminée' : 'Flashcards'}
      >
        <span className="font-mono text-[13px] text-text2" aria-live="polite">
          {correct}/{answered.length} juste{correct > 1 ? 's' : ''}
        </span>
      </PageTitle>
      <div className="h-1 rounded bg-raised" role="progressbar" aria-label="Avancement de la session" aria-valuemin={0} aria-valuemax={cards.length} aria-valuenow={answered.length}>
        <div className="h-full rounded bg-accent" style={{ width: `${cards.length ? (answered.length / cards.length) * 100 : 0}%` }} />
      </div>

      {failure && (
        <div role="alert" className="rounded-[10px] border px-4 py-3 text-[13.5px] text-text2" style={{ borderColor: 'rgba(255,107,94,.45)', background: 'rgba(255,107,94,.07)' }}>
          {failure}
        </div>
      )}

      {done ? (
        <section aria-labelledby="bilan-h" className="panel-deep flex flex-col gap-4 px-5 py-6 sm:px-7">
          <h2 id="bilan-h" className="text-xl font-semibold">
            {correct}/{cards.length} bonnes réponses
          </h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {cards.map((c, i) => (
              <li key={c.questionId} className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[#1A2539] bg-well px-4 py-2.5 text-[14px]">
                <span className="font-mono text-[12px] text-muted">{String(i + 1).padStart(2, '0')}</span>
                <span className="min-w-0 flex-[1_1_240px] truncate">{c.body.stem}</span>
                {c.answer ? (
                  <>
                    <span className={c.answer.correct ? 'pill-ok' : 'pill-crit'}>{c.answer.correct ? '✓ JUSTE' : '✕ FAUX'}</span>
                    <span className="font-mono text-[12px] text-text2">
                      boîte {c.answer.boxAfter}/{LEITNER_BOXES} · {dueLabel(c.answer.dueAfter, serverNow())}
                    </span>
                  </>
                ) : (
                  <span className="pill-neutral">NON RÉPONDUE</span>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Link to="/revision" className="btn-primary">
              Retour aux paquets
            </Link>
            <Link to="/" className="btn-secondary">
              Tableau de bord
            </Link>
          </div>
        </section>
      ) : (
        card && (
          <section aria-labelledby="card-h" className="panel flex flex-col gap-5 px-5 py-6 sm:px-7">
            <h2 id="card-h" className="sr-only">
              Carte {index + 1} sur {cards.length}
            </h2>
            <div className="flex flex-wrap gap-2">
              <span className="chip">{QUESTION_TYPE_LABEL[card.body.type]}</span>
              {card.subtopic && (
                <span className="chip">
                  {card.subtopic} {card.subtopicName?.toUpperCase()}
                </span>
              )}
            </div>
            <p ref={stemRef} tabIndex={-1} className="m-0 whitespace-pre-line text-[18px] leading-[1.55] outline-none [overflow-wrap:anywhere]">
              {card.body.stem}
              {card.body.type === 'mcq_multi' && <span className="text-muted"> (Choisissez {card.body.selectCount} réponses.)</span>}
            </p>
            {card.body.exhibit && <Exhibit text={card.body.exhibit} />}
            <AnswerInput key={card.questionId} body={card.body} value={card.answer?.response ?? draft} onChange={setDraft} disabled={busy || card.answer !== null} />

            {card.answer ? (
              <section
                aria-live="polite"
                aria-label="Correction"
                className="flex flex-col gap-3 rounded-xl border px-5 py-4"
                style={{
                  borderColor: card.answer.correct ? 'rgba(61,220,151,.4)' : 'rgba(255,107,94,.45)',
                  background: card.answer.correct ? 'rgba(61,220,151,.06)' : 'rgba(255,107,94,.06)',
                }}
              >
                <div className={`font-mono text-[13px] font-semibold ${card.answer.correct ? 'text-ok' : 'text-crit'}`}>
                  {card.answer.correct ? '✓ BONNE RÉPONSE' : '✕ RÉPONSE INCORRECTE'}
                </div>
                {!card.answer.correct && <ReviewAnswer body={card.body} answerKey={card.answer.feedback.key} response={card.answer.response} />}
                <div>
                  <div className="label-mono mb-1.5 tracking-[1px]">Explication</div>
                  <p className="m-0 whitespace-pre-line text-[14px] text-[#C9D4E5]">{card.answer.feedback.explanation}</p>
                </div>
                {Object.keys(card.answer.feedback.distractorNotes).length > 0 && (
                  <div className="text-[14px]">
                    <div className="label-mono mb-1.5 tracking-[1px]">Pourquoi les autres réponses sont fausses</div>
                    <DistractorNotes body={card.body} notes={card.answer.feedback.distractorNotes} />
                  </div>
                )}
                <p className="m-0 font-mono text-[12.5px] text-text2">
                  Boîte {card.answer.boxAfter}/{LEITNER_BOXES} · prochaine révision {dueLabel(card.answer.dueAfter, serverNow())} ({formatDate(card.answer.dueAfter)})
                </p>
                <button ref={nextRef} type="button" className="btn-primary self-start" onClick={() => setIndex((i) => i + 1)}>
                  {index + 1 < cards.length ? 'Carte suivante →' : 'Voir le bilan →'}
                </button>
              </section>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary" disabled={busy || !isComplete(card.body, draft)} onClick={() => void submit()}>
                  {busy ? 'Correction…' : 'Valider'}
                </button>
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => setIndex((i) => i + 1)}>
                  Passer
                </button>
              </div>
            )}
          </section>
        )
      )}
    </div>
  );
}
