import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { WithCertification } from '../certification/CertificationContext';
import { EmptyState, ErrorBox, PageTitle, Spinner } from '../components/ui';
import { certificationLabel } from '../lib/certification';
import { beatsTarget, filterChallenges, MODE_LABEL, NO_CHALLENGE_FILTERS, type ChallengeFilters, type ChallengeStatusFilter } from '../lib/challenges';
import { formatDuration } from '../lib/format';
import { DIFFICULTY_LABEL, labSubtopics } from '../lib/labs';
import type { CertificationSummary, ChallengeMode, LabDifficulty, LabSummary } from '../lib/types';
import { useApi } from '../lib/useApi';
import { DifficultyPill } from './LabsPage';

export function ChallengesPage() {
  return <WithCertification>{(c) => <Challenges key={c.code} cert={c} />}</WithCertification>;
}

function ModePill({ mode }: { mode: ChallengeMode }) {
  return <span className={mode === 'troubleshoot' ? 'pill-warn' : 'pill-neutral'}>{MODE_LABEL[mode].toUpperCase()}</span>;
}

function ChallengeRow({ c }: { c: LabSummary }) {
  const info = c.challenge!;
  const action = c.inProgress ? 'Reprendre' : c.done ? 'Rejouer' : 'Ouvrir';
  const beaten = beatsTarget(c.bestSeconds, info.targetMinutes);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border border-[#1A2539] bg-well px-4 py-3">
      <span className="min-w-0 flex-[1_1_240px]">
        <span className="block font-medium">{c.title}</span>
        <span className="font-mono text-[12px] text-muted">
          {c.subtopic} · {c.subtopicName} · {c.objectiveCount} objectifs · cible {info.targetMinutes} min
          {c.devices.length > 1 ? ` · ${c.devices.join(' + ')}` : ''}
        </span>
      </span>
      <ModePill mode={info.mode} />
      <DifficultyPill difficulty={c.difficulty} />
      <span className="w-[130px] font-mono text-[12px] text-text2">
        <span className="sr-only">Meilleur temps : </span>
        {c.bestSeconds !== null ? (
          <>
            ⏱ {formatDuration(c.bestSeconds)}
            {beaten && <span className="ml-1 text-ok">★<span className="sr-only"> (temps cible battu)</span></span>}
          </>
        ) : (
          '—'
        )}
      </span>
      <Link to={`/challenges/${c.slug}`} className="btn-secondary btn-sm" aria-label={`${action} le challenge ${c.title}`}>
        {action} →
      </Link>
    </li>
  );
}

function Challenges({ cert }: { cert: CertificationSummary }) {
  const { data, error, loading, reload } = useApi<{ labs: LabSummary[] }>(`/labs?certification=${encodeURIComponent(cert.code)}&kind=challenge`);
  const [filters, setFilters] = useState<ChallengeFilters>(NO_CHALLENGE_FILTERS);
  const subtopicId = useId();
  const difficultyId = useId();
  const modeId = useId();
  const list = data?.labs ?? [];
  const shown = filterChallenges(list, filters);
  const done = list.filter((l) => l.done).length;
  const count = (status: ChallengeStatusFilter) => filterChallenges(list, { ...filters, status }).length;

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-[22px]">
      <PageTitle
        eyebrow={
          <>
            <span className="text-accent">●</span> {certificationLabel(cert)} · CHALLENGES CHRONOMÉTRÉS
          </>
        }
        title="Challenges"
      >
        {data && (
          <span className="font-mono text-[13px] text-text2">
            {done}/{list.length} réussis
          </span>
        )}
      </PageTitle>
      <p className="m-0 max-w-prose text-text2">
        Des labs contre la montre, sans indice : construisez une configuration ou trouvez les pannes semées dans celle de départ. Le
        challenge s’arrête dès que tous les objectifs sont atteints, ou à l’échéance. Battez votre meilleur temps.
      </p>

      {loading && !data && <Spinner label="Chargement des challenges…" />}
      {error != null && <ErrorBox error={error} onRetry={reload} title="Challenges indisponibles" />}
      {data && (
        <section aria-labelledby="challenges-h" className="panel flex flex-col gap-4 px-4 py-5 sm:px-6">
          <h2 id="challenges-h" className="sr-only">
            Liste des challenges
          </h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-1.5">
              <label htmlFor={subtopicId} className="label-mono">
                Sous-thème
              </label>
              <select id={subtopicId} className="field w-full" value={filters.subtopic} onChange={(e) => setFilters((f) => ({ ...f, subtopic: e.target.value }))}>
                <option value="">Tous les sous-thèmes</option>
                {labSubtopics(list).map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex min-w-0 flex-[0_1_160px] flex-col gap-1.5">
              <label htmlFor={modeId} className="label-mono">
                Mode
              </label>
              <select id={modeId} className="field w-full" value={filters.mode} onChange={(e) => setFilters((f) => ({ ...f, mode: e.target.value as ChallengeFilters['mode'] }))}>
                <option value="">Tous</option>
                {(Object.keys(MODE_LABEL) as ChallengeMode[]).map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABEL[m]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex min-w-0 flex-[0_1_160px] flex-col gap-1.5">
              <label htmlFor={difficultyId} className="label-mono">
                Difficulté
              </label>
              <select
                id={difficultyId}
                className="field w-full"
                value={filters.difficulty}
                onChange={(e) => setFilters((f) => ({ ...f, difficulty: e.target.value as ChallengeFilters['difficulty'] }))}
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
                  ['done', 'Réussis'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={filters.status === k}
                  onClick={() => setFilters((f) => ({ ...f, status: k }))}
                  className={`min-h-[44px] rounded-md border px-3 ${filters.status === k ? 'border-line2 bg-raised text-text' : 'border-[#223049] text-muted hover:text-text'}`}
                >
                  {label} ({count(k)})
                </button>
              ))}
            </div>
          </div>
          {shown.length === 0 ? (
            <EmptyState title={list.length ? 'Aucun challenge ne correspond à ces filtres.' : 'Aucun challenge pour cette certification.'}>
              {list.length ? 'Élargissez les filtres pour voir les autres challenges.' : 'Les challenges apparaîtront ici dès qu’ils seront publiés.'}
            </EmptyState>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={`${shown.length} challenge${shown.length > 1 ? 's' : ''}`}>
              {shown.map((c) => (
                <ChallengeRow key={c.slug} c={c} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

export { ModePill };
