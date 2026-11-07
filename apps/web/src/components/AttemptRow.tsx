import { Link } from 'react-router-dom';
import { formatDateTime } from '../lib/format';
import type { AttemptSummary } from '../lib/types';

export const MODE_LABEL = { exam: 'Examen blanc', practice: 'Entraînement' } as const;

export function Verdict({ attempt }: { attempt: Pick<AttemptSummary, 'status' | 'mode' | 'passed'> }) {
  if (attempt.status === 'in_progress') return <span className="pill-neutral">EN COURS</span>;
  if (attempt.mode === 'practice') return <span className="pill-neutral">{attempt.status === 'expired' ? 'EXPIRÉ' : 'TERMINÉ'}</span>;
  return attempt.passed ? <span className="pill-ok">✓ ADMIS</span> : <span className="pill-crit">✕ NON ADMIS</span>;
}

/** Ligne de tentative (tableau de bord et historique). */
export function AttemptRow({ attempt: a, compact = false }: { attempt: AttemptSummary; compact?: boolean }) {
  const href = a.status === 'in_progress' ? `/tentatives/${a.id}` : `/tentatives/${a.id}/resultat`;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border border-[#1A2539] bg-well px-4 py-3">
      <span className="min-w-0 flex-[1_1_220px]">
        <span className="block font-medium">
          {MODE_LABEL[a.mode]} · {a.certification.toUpperCase()}
        </span>
        <span className="font-mono text-[12px] text-muted">{formatDateTime(a.startedAt)}</span>
      </span>
      <span className="font-mono text-[13px] text-text2">
        {a.correctCount !== null ? `${a.correctCount}/${a.totalCount}` : `${a.totalCount} q.`}
      </span>
      {!compact || a.scaledScore !== null ? (
        <span className="w-12 text-right font-mono text-[15px] font-semibold">{a.scaledScore ?? '—'}</span>
      ) : null}
      <Verdict attempt={a} />
      <Link
        to={href}
        className="btn-secondary btn-sm"
        aria-label={`${a.status === 'in_progress' ? 'Reprendre' : 'Voir le résultat de'} la session du ${formatDateTime(a.startedAt)}`}
      >
        {a.status === 'in_progress' ? 'Reprendre →' : 'Résultat →'}
      </Link>
    </li>
  );
}
