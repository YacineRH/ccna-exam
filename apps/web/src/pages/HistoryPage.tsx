import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AttemptRow } from '../components/AttemptRow';
import { EmptyState, ErrorBox, Spinner } from '../components/ui';
import type { AttemptMode, AttemptSummary } from '../lib/types';
import { useApi } from '../lib/useApi';

type Filter = 'all' | AttemptMode;

export function HistoryPage() {
  const { data, error, loading, reload } = useApi<{ attempts: AttemptSummary[] }>('/attempts');
  const [filter, setFilter] = useState<Filter>('all');
  const attempts = data?.attempts ?? [];
  const shown = filter === 'all' ? attempts : attempts.filter((a) => a.mode === filter);
  const count = (f: Filter) => (f === 'all' ? attempts.length : attempts.filter((a) => a.mode === f).length);

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-[22px]">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-[1_1_320px]">
          <div className="font-mono text-[12px] font-medium tracking-[0.6px] text-muted">
            <span className="text-accent">●</span> CCNA 200-301 · 50 DERNIÈRES SESSIONS
          </div>
          <h1 className="mt-1.5 text-[28px] font-semibold sm:text-[34px]">Historique</h1>
        </div>
        <div role="group" aria-label="Filtrer par mode" className="flex flex-wrap gap-1.5 font-mono text-[12px] font-medium">
          {(
            [
              ['all', 'Toutes'],
              ['exam', 'Examens blancs'],
              ['practice', 'Entraînements'],
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
              Les examens blancs et entraînements terminés ou en cours apparaîtront ici, avec un lien vers leur post-mortem.
            </EmptyState>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {shown.map((a) => (
                <AttemptRow key={a.id} attempt={a} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
