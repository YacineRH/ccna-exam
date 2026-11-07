import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { WithCertification } from '../certification/CertificationContext';
import { EmptyState, ErrorBox, PageTitle, Spinner } from '../components/ui';
import { certificationLabel } from '../lib/certification';
import { formatDuration } from '../lib/format';
import { DIFFICULTY_LABEL, filterLabs, labSubtopics, NO_FILTERS, type LabFilters, type LabStatusFilter } from '../lib/labs';
import type { CertificationSummary, LabDifficulty, LabSummary } from '../lib/types';
import { useApi } from '../lib/useApi';

export function DifficultyPill({ difficulty }: { difficulty: LabDifficulty }) {
  const cls = difficulty === 'easy' ? 'pill-ok' : difficulty === 'medium' ? 'pill-warn' : 'pill-crit';
  return <span className={cls}>{DIFFICULTY_LABEL[difficulty].toUpperCase()}</span>;
}

export function LabsPage() {
  return <WithCertification>{(c) => <Labs key={c.code} cert={c} />}</WithCertification>;
}

function LabRow({ lab }: { lab: LabSummary }) {
  const action = lab.inProgress ? 'Reprendre' : lab.done ? 'Refaire' : 'Ouvrir';
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border border-[#1A2539] bg-well px-4 py-3">
      <span className="min-w-0 flex-[1_1_240px]">
        <span className="block font-medium">{lab.title}</span>
        <span className="font-mono text-[12px] text-muted">
          {lab.subtopic} · {lab.subtopicName} · {lab.objectiveCount} objectifs · ~{lab.estimatedMinutes} min
          {lab.devices.length > 1 ? ` · ${lab.devices.join(' + ')}` : ''}
        </span>
      </span>
      <DifficultyPill difficulty={lab.difficulty} />
      <span className="w-[110px] font-mono text-[12px] text-text2" title="Meilleur temps de réussite">
        {lab.bestSeconds !== null ? `⏱ ${formatDuration(lab.bestSeconds)}` : '—'}
      </span>
      {lab.done ? (
        <span className="pill-ok">✓ FAIT</span>
      ) : lab.inProgress ? (
        <span className="pill-neutral">EN COURS</span>
      ) : (
        <span className="pill-neutral">À FAIRE</span>
      )}
      <Link to={`/labs/cli/${lab.slug}`} className="btn-secondary btn-sm" aria-label={`${action} le lab ${lab.title}`}>
        {action} →
      </Link>
    </li>
  );
}

function Labs({ cert }: { cert: CertificationSummary }) {
  const { data, error, loading, reload } = useApi<{ labs: LabSummary[] }>(`/labs?certification=${encodeURIComponent(cert.code)}`);
  const [filters, setFilters] = useState<LabFilters>(NO_FILTERS);
  const subtopicId = useId();
  const difficultyId = useId();
  const labs = data?.labs ?? [];
  const shown = filterLabs(labs, filters);
  const done = labs.filter((l) => l.done).length;
  const count = (status: LabStatusFilter) => filterLabs(labs, { ...filters, status }).length;

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-[22px]">
      <PageTitle
        eyebrow={
          <>
            <span className="text-accent">●</span> {certificationLabel(cert)} · LABS CISCO IOS
          </>
        }
        title="CLI trainer"
      >
        {data && (
          <span className="font-mono text-[13px] text-text2">
            {done}/{labs.length} labs réussis
          </span>
        )}
      </PageTitle>
      <p className="m-0 max-w-prose text-text2">
        Configurez des routeurs et commutateurs simulés en ligne de commande. Chaque lab vérifie vos objectifs en direct, propose trois
        indices progressifs et révèle la solution à la fin.
      </p>

      {loading && !data && <Spinner />}
      {error != null && <ErrorBox error={error} onRetry={reload} title="Labs indisponibles" />}
      {data && (
        <section aria-label="Labs" className="panel flex flex-col gap-4 px-4 py-5 sm:px-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-1.5">
              <label htmlFor={subtopicId} className="label-mono">
                Sous-thème
              </label>
              <select
                id={subtopicId}
                className="field w-full"
                value={filters.subtopic}
                onChange={(e) => setFilters((f) => ({ ...f, subtopic: e.target.value }))}
              >
                <option value="">Tous les sous-thèmes</option>
                {labSubtopics(labs).map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex min-w-0 flex-[0_1_180px] flex-col gap-1.5">
              <label htmlFor={difficultyId} className="label-mono">
                Difficulté
              </label>
              <select
                id={difficultyId}
                className="field w-full"
                value={filters.difficulty}
                onChange={(e) => setFilters((f) => ({ ...f, difficulty: e.target.value as LabFilters['difficulty'] }))}
              >
                <option value="">Toutes</option>
                {(Object.keys(DIFFICULTY_LABEL) as LabDifficulty[]).map((d) => (
                  <option key={d} value={d}>
                    {DIFFICULTY_LABEL[d]}
                  </option>
                ))}
              </select>
            </div>
            <div role="group" aria-label="Filtrer par avancement" className="flex flex-wrap gap-1.5 font-mono text-[12px] font-medium">
              {(
                [
                  ['all', 'Tous'],
                  ['todo', 'À faire'],
                  ['done', 'Faits'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={filters.status === k}
                  onClick={() => setFilters((f) => ({ ...f, status: k }))}
                  className={`min-h-[44px] rounded-md border px-3 ${
                    filters.status === k ? 'border-line2 bg-raised text-text' : 'border-[#223049] text-muted hover:text-text'
                  }`}
                >
                  {label} ({count(k)})
                </button>
              ))}
            </div>
          </div>
          {shown.length === 0 ? (
            <EmptyState title={labs.length ? 'Aucun lab ne correspond à ces filtres.' : 'Aucun lab pour cette certification.'}>
              {labs.length ? 'Élargissez les filtres pour voir les autres labs.' : 'Les labs CLI apparaîtront ici dès qu’ils seront publiés.'}
            </EmptyState>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={`${shown.length} lab${shown.length > 1 ? 's' : ''}`}>
              {shown.map((l) => (
                <LabRow key={l.slug} lab={l} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
