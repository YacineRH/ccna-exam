import { useState } from 'react';
import { Link } from 'react-router-dom';
import { WithCertification } from '../certification/CertificationContext';
import { AttemptRow } from '../components/AttemptRow';
import { EmptyState, ErrorBox, Spinner } from '../components/ui';
import { certificationLabel } from '../lib/certification';
import { formatDateTime, formatDuration } from '../lib/format';
import type { AttemptMode, AttemptSummary, CertificationSummary, LabAttemptSummary, RevisionSessionSummary } from '../lib/types';
import { useApi } from '../lib/useApi';

type Filter = 'all' | AttemptMode | 'lab' | 'challenge' | 'revision';

/** Ligne d'une session de lab CLI ou d'un essai de challenge : temps, indices, réussite. */
function LabAttemptRow({ attempt: a }: { attempt: LabAttemptSummary }) {
  const running = a.status === 'in_progress';
  const challenge = a.kind === 'challenge';
  const what = challenge ? 'l’essai de challenge' : 'la session de lab';
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border border-[#1A2539] bg-well px-4 py-3">
      <span className="min-w-0 flex-[1_1_220px]">
        <span className="block font-medium">
          {challenge ? 'Challenge' : 'Lab CLI'} · {a.title}
        </span>
        <span className="font-mono text-[12px] text-muted">
          {formatDateTime(a.startedAt)} · {a.subtopic}
        </span>
      </span>
      <span className="font-mono text-[13px] text-text2">
        {a.durationSeconds !== null ? formatDuration(a.durationSeconds) : '—'}
        {challenge ? (a.expired ? ' · temps écoulé' : '') : ` · ${a.hintsUsed} indice${a.hintsUsed > 1 ? 's' : ''}`}
      </span>
      {running ? <span className="pill-neutral">EN COURS</span> : a.success ? <span className="pill-ok">✓ RÉUSSI</span> : <span className="pill-crit">✕ NON RÉUSSI</span>}
      <Link
        to={`${challenge ? '/challenges' : '/labs/cli'}/sessions/${a.id}`}
        className="btn-secondary btn-sm"
        aria-label={`${running ? 'Reprendre' : 'Voir le résultat de'} ${what} du ${formatDateTime(a.startedAt)}`}
      >
        {running ? 'Reprendre →' : 'Résultat →'}
      </Link>
    </li>
  );
}

/** Ligne d'une session de révision espacée : cartes répondues et justes. */
function RevisionRow({ session: s }: { session: RevisionSessionSummary }) {
  const open = s.answeredCount < s.total;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border border-[#1A2539] bg-well px-4 py-3">
      <span className="min-w-0 flex-[1_1_220px]">
        <span className="block font-medium">Révision · {s.subtopicName ?? 'cartes dues'}</span>
        <span className="font-mono text-[12px] text-muted">
          {formatDateTime(s.startedAt)}
          {s.subtopic ? ` · ${s.subtopic}` : ''}
        </span>
      </span>
      <span className="font-mono text-[13px] text-text2">
        {s.correctCount}/{s.answeredCount} juste{s.correctCount > 1 ? 's' : ''} · {s.total} carte{s.total > 1 ? 's' : ''}
      </span>
      {open ? <span className="pill-neutral">EN COURS</span> : <span className="pill-ok">✓ TERMINÉE</span>}
      <Link to={`/revision/sessions/${s.id}`} className="btn-secondary btn-sm" aria-label={`${open ? 'Reprendre' : 'Revoir'} la session de révision du ${formatDateTime(s.startedAt)}`}>
        {open ? 'Reprendre →' : 'Bilan →'}
      </Link>
    </li>
  );
}

export function HistoryPage() {
  return <WithCertification>{(c) => <History key={c.code} cert={c} />}</WithCertification>;
}

function History({ cert }: { cert: CertificationSummary }) {
  const { data, error, loading, reload } = useApi<{ attempts: AttemptSummary[] }>(`/attempts?certification=${encodeURIComponent(cert.code)}`);
  const labData = useApi<{ attempts: LabAttemptSummary[] }>(`/lab-attempts?certification=${encodeURIComponent(cert.code)}`);
  const revisionData = useApi<{ sessions: RevisionSessionSummary[] }>(`/revision/sessions?certification=${encodeURIComponent(cert.code)}`);
  const [filter, setFilter] = useState<Filter>('all');
  const attempts = data?.attempts ?? [];
  const labAttempts = labData.data?.attempts ?? [];
  const revisions = revisionData.data?.sessions ?? [];
  // Examens, entraînements, labs, challenges et révisions, du plus récent au plus ancien.
  type Row =
    | { kind: 'exam'; at: string; a: AttemptSummary }
    | { kind: 'lab' | 'challenge'; at: string; a: LabAttemptSummary }
    | { kind: 'revision'; at: string; a: RevisionSessionSummary };
  const rows: Row[] = [
    ...attempts.map((a): Row => ({ kind: 'exam', at: a.startedAt, a })),
    ...labAttempts.map((a): Row => ({ kind: a.kind === 'challenge' ? 'challenge' : 'lab', at: a.startedAt, a })),
    ...revisions.map((a): Row => ({ kind: 'revision', at: a.startedAt, a })),
  ].sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
  const keep = (f: Filter) => (r: Row) => f === 'all' || (r.kind === 'exam' ? r.a.mode === f : r.kind === f);
  const shown = rows.filter(keep(filter));
  const count = (f: Filter) => rows.filter(keep(f)).length;

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-[22px]">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-[1_1_320px]">
          <div className="font-mono text-[12px] font-medium tracking-[0.6px] text-muted">
            <span className="text-accent">●</span> {certificationLabel(cert)} · 50 DERNIÈRES SESSIONS
          </div>
          <h1 className="mt-1.5 text-[28px] font-semibold sm:text-[34px]">Historique</h1>
        </div>
        <div role="group" aria-label="Filtrer par mode" className="flex flex-wrap gap-1.5 font-mono text-[12px] font-medium">
          {(
            [
              ['all', 'Toutes'],
              ['exam', 'Examens blancs'],
              ['practice', 'Entraînements'],
              ['lab', 'Labs CLI'],
              ['challenge', 'Challenges'],
              ['revision', 'Révision'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={filter === k}
              onClick={() => setFilter(k)}
              className={`min-h-[44px] rounded-md border px-3 ${
                filter === k ? 'border-line2 bg-raised text-text' : 'border-[#223049] text-muted hover:text-text'
              }`}
            >
              {label} ({count(k)})
            </button>
          ))}
        </div>
      </div>

      {loading && !data && <Spinner />}
      {error != null && <ErrorBox error={error} onRetry={reload} title="Historique indisponible" />}
      {labData.error != null && <ErrorBox error={labData.error} onRetry={labData.reload} title="Historique des labs indisponible" />}
      {revisionData.error != null && <ErrorBox error={revisionData.error} onRetry={revisionData.reload} title="Historique des révisions indisponible" />}
      {data && (
        <section aria-label="Sessions" className="panel px-4 py-5 sm:px-6">
          {shown.length === 0 ? (
            <EmptyState
              title="Aucune session pour l'instant."
              action={
                <Link to="/examen/nouveau" className="btn-primary">
                  Démarrer une session
                </Link>
              }
            >
              Les examens blancs, entraînements, labs, challenges et révisions, terminés ou en cours, apparaîtront ici avec un lien vers
              leur bilan.
            </EmptyState>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {shown.map((r) =>
                r.kind === 'exam' ? (
                  <AttemptRow key={r.a.id} attempt={r.a} />
                ) : r.kind === 'revision' ? (
                  <RevisionRow key={r.a.id} session={r.a} />
                ) : (
                  <LabAttemptRow key={r.a.id} attempt={r.a} />
                ),
              )}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
