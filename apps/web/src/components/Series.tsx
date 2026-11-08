import { useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { bestScores, examAriaLabel, examState, parseExamNumber, seriesCountLabel, type SeriesExamState } from '../lib/series';
import type { AttemptState, SeriesExam, SeriesProgress } from '../lib/types';
import { IconPlay } from './Icons';
import { ErrorBox } from './ui';

const TILE: Record<SeriesExamState, string> = {
  passed: 'border-[rgba(61,220,151,.55)] bg-[rgba(61,220,151,.10)] text-text',
  failed: 'border-[rgba(245,181,68,.5)] bg-[rgba(245,181,68,.08)] text-text',
  in_progress: 'border-dashed border-accent text-text',
  never: 'border-line2 text-text2',
};
const MARK: Record<SeriesExamState, string> = { passed: '✓', failed: '', in_progress: '…', never: '' };

/** Lance un examen figé par son numéro, puis ouvre la tentative. */
function useStartExam(code: string) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const start = async (number: number) => {
    if (busy !== null) return;
    setBusy(number);
    setError(null);
    try {
      const attempt = await api<AttemptState>('/attempts', { method: 'POST', body: { certification: code, mode: 'exam', examNumber: number } });
      navigate(`/tentatives/${attempt.id}`);
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  };
  return { start, busy, error };
}

function ProgressLine({ progress }: { progress: SeriesProgress }) {
  const pct = progress.total ? Math.round((100 * progress.taken) / progress.total) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[15px] font-semibold text-text">{seriesCountLabel(progress)}</span>
        <span className="font-mono text-[12px] text-muted">
          {progress.passed} réussi{progress.passed > 1 ? 's' : ''} (≥ {progress.passingScore})
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Examens de la série passés"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.taken}
        aria-valuetext={seriesCountLabel(progress)}
        className="h-2 overflow-hidden rounded-full bg-raised"
      >
        <span className="block h-full rounded-full bg-accent motion-safe:transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * Grille des examens de la série : un groupe de boutons radio (flèches du clavier pour se déplacer,
 * un seul arrêt de tabulation), une case par numéro, état et meilleur score dans le nom accessible.
 */
export function SeriesGrid({ exams, selected, onSelect }: { exams: SeriesExam[]; selected: number | null; onSelect: (n: number) => void }) {
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="sr-only">Choisir un examen de la série</legend>
      <ul className="grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(46px,1fr))]">
        {exams.map((e) => {
          const state = examState(e);
          const on = selected === e.number;
          return (
            <li key={e.number}>
              <label className="block cursor-pointer" title={examAriaLabel(e)}>
                <input
                  type="radio"
                  name="examen-serie"
                  value={e.number}
                  checked={on}
                  onChange={() => onSelect(e.number)}
                  aria-label={examAriaLabel(e)}
                  className="peer sr-only"
                />
                <span
                  aria-hidden
                  className={`flex min-h-[46px] flex-col items-center justify-center rounded-lg border font-mono leading-none peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${TILE[state]} ${
                    on ? 'ring-2 ring-accent' : ''
                  }`}
                >
                  <span className="text-[13px] font-semibold">
                    {e.number}
                    {MARK[state] && <span className="ml-0.5 text-[10px]">{MARK[state]}</span>}
                  </span>
                  {e.bestScore !== null && <span className="mt-1 text-[10px] text-muted">{e.bestScore}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function Legend() {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 font-mono text-[11px] text-muted" aria-label="Légende de la grille">
      <li>
        <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-[rgba(61,220,151,.55)] bg-[rgba(61,220,151,.10)] align-middle" /> ✓ réussi
      </li>
      <li>
        <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-[rgba(245,181,68,.5)] bg-[rgba(245,181,68,.08)] align-middle" /> passé, sous le seuil
      </li>
      <li>
        <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-accent align-middle" /> … en cours
      </li>
      <li>
        <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-line2 align-middle" /> jamais passé
      </li>
      <li>sous le numéro : meilleur score</li>
    </ul>
  );
}

/** Écran de lancement : choisir un examen de la série par son numéro, ou le prochain jamais passé. */
export function SeriesLaunchPanel({ code, progress, initial }: { code: string; progress: SeriesProgress; initial: number | null }) {
  const { start, busy, error } = useStartExam(code);
  const first = initial ?? progress.nextNumber ?? 1;
  const [selected, setSelected] = useState<number | null>(first);
  const [typed, setTyped] = useState(String(first));
  const chosen = parseExamNumber(typed, progress.total);
  const exam = chosen !== null ? progress.exams[chosen - 1] : undefined;
  const select = (n: number) => {
    setSelected(n);
    setTyped(String(n));
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // Entrée lance l'examen saisi, pas le tirage du formulaire qui entoure le panneau.
    if (e.key === 'Enter') {
      e.preventDefault();
      if (chosen !== null && !exam?.inProgress) void start(chosen);
    }
  };

  return (
    <section aria-labelledby="serie-h" className="panel flex flex-col gap-4 px-5 py-5 sm:px-6">
      <div className="flex flex-col gap-1">
        <h2 id="serie-h" className="text-base font-semibold">
          Série de {progress.total} examens blancs
        </h2>
        <p className="m-0 text-[13px] text-text2">
          Chaque examen est figé : mêmes questions à chaque passage, au format officiel, et deux examens n'ont que peu de questions en commun.
        </p>
      </div>
      <ProgressLine progress={progress} />

      {progress.nextNumber !== null ? (
        <div>
          <button type="button" className="btn-primary" onClick={() => void start(progress.nextNumber as number)} disabled={busy !== null}>
            <IconPlay />
            {busy === progress.nextNumber ? 'Préparation…' : `Passer l'examen n° ${progress.nextNumber}, jamais passé`}
          </button>
        </div>
      ) : (
        <p className="m-0 font-mono text-[12px] text-ok">✓ Tous les examens de la série ont été commencés.</p>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="examen-numero" className="label-mono">
          Ou choisir un numéro
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <span className="field w-[110px]">
            <input
              id="examen-numero"
              type="number"
              inputMode="numeric"
              min={1}
              max={progress.total}
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                const n = parseExamNumber(e.target.value, progress.total);
                if (n !== null) setSelected(n);
              }}
              onKeyDown={onKey}
              aria-describedby="examen-numero-etat"
              aria-invalid={chosen === null}
              className="input-bare font-mono text-lg font-semibold"
            />
          </span>
          {exam?.inProgress ? (
            <Link to={`/tentatives/${exam.inProgress}`} className="btn-secondary">
              Reprendre l'examen n° {exam.number}
            </Link>
          ) : (
            <button type="button" className="btn-secondary" disabled={chosen === null || busy !== null} onClick={() => chosen !== null && void start(chosen)}>
              {busy !== null && busy === chosen ? 'Préparation…' : chosen !== null ? `Lancer l'examen n° ${chosen}` : 'Lancer'}
            </button>
          )}
        </div>
        <p id="examen-numero-etat" className="m-0 text-[13px] text-text2" aria-live="polite">
          {chosen === null
            ? `Saisissez un numéro de 1 à ${progress.total}.`
            : exam
              ? exam.taken > 0
                ? `Passé ${exam.taken} fois, meilleur score ${exam.bestScore}${exam.lastAt ? `, dernier passage le ${formatDate(exam.lastAt)}` : ''}.`
                : exam.inProgress
                  ? 'Un passage est en cours : reprenez-le là où vous l’avez laissé.'
                  : `Jamais passé · ${exam.questionCount} questions.`
              : ''}
        </p>
      </div>

      <details className="group" open={progress.total <= 120}>
        <summary className="min-h-[44px] cursor-pointer py-2 font-mono text-[12px] text-muted">Tous les examens de la série</summary>
        <div className="flex flex-col gap-3 pt-1">
          <SeriesGrid exams={progress.exams} selected={selected} onSelect={select} />
          <Legend />
        </div>
      </details>
      {error != null && <ErrorBox error={error} title="Impossible de lancer l'examen" />}
    </section>
  );
}

/** Courbe des meilleurs scores, une barre par examen de la série (vide s'il n'a pas été passé). */
function BestScoresChart({ progress, min, max }: { progress: SeriesProgress; min: number; max: number }) {
  const scores = bestScores(progress);
  const W = 600;
  const H = 120;
  const slot = W / Math.max(1, progress.total);
  const y = (s: number) => H - ((s - min) / (max - min)) * H;
  const above = scores.filter((s) => s.passed).length;
  return (
    <svg
      viewBox={`0 0 ${W} ${H + 2}`}
      className="h-[122px] w-full"
      role="img"
      aria-label={`Meilleur score de ${scores.length} examen${scores.length > 1 ? 's' : ''} passé${scores.length > 1 ? 's' : ''} sur ${progress.total}, dont ${above} au-dessus du seuil de ${progress.passingScore}.`}
      preserveAspectRatio="none"
    >
      <rect x={0} y={0} width={W} height={H} fill="#0B111D" />
      {scores.map((s) => (
        <rect
          key={s.number}
          x={(s.number - 1) * slot + slot * 0.15}
          width={slot * 0.7}
          y={y(s.score)}
          height={H - y(s.score)}
          fill={s.passed ? '#3DDC97' : '#F5B544'}
          opacity={0.85}
        />
      ))}
      <line x1={0} x2={W} y1={y(progress.passingScore)} y2={y(progress.passingScore)} stroke="#3DDC97" strokeDasharray="4 4" strokeWidth={1} />
    </svg>
  );
}

/** Tableau de bord : progression dans la série et meilleur score par examen. */
export function SeriesDashboardCard({ code, progress, min, max }: { code: string; progress: SeriesProgress; min: number; max: number }) {
  const { start, busy, error } = useStartExam(code);
  const passed = progress.exams.filter((e) => e.taken > 0);
  return (
    <section aria-labelledby="serie-dash-h" className="panel flex flex-col gap-4 px-6 py-[22px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="serie-dash-h" className="text-base font-semibold">
          Série d'examens blancs
        </h2>
        <Link to="/examen/nouveau?mode=exam" className="font-mono text-[12px]">
          Choisir un examen →
        </Link>
      </div>
      <ProgressLine progress={progress} />
      {passed.length > 0 && (
        <>
          <BestScoresChart progress={progress} min={min} max={max} />
          <details>
            <summary className="min-h-[44px] cursor-pointer py-2 font-mono text-[12px] text-muted">Meilleur score par examen ({passed.length})</summary>
            <div className="max-h-[320px] overflow-auto" tabIndex={0} aria-label="Meilleur score par examen">
              <table className="w-full border-collapse text-left text-[13px]">
                <thead>
                  <tr className="font-mono text-[11px] text-muted">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Examen</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Meilleur score</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Passages</th>
                    <th scope="col" className="py-1.5 font-medium">Dernier</th>
                  </tr>
                </thead>
                <tbody>
                  {passed.map((e) => (
                    <tr key={e.number} className="border-t border-raised">
                      <td className="py-1.5 pr-3 font-mono">
                        <Link to={`/examen/nouveau?mode=exam&examen=${e.number}`} aria-label={`Examen n° ${e.number}`}>
                          n° {e.number}
                        </Link>
                      </td>
                      <td className={`py-1.5 pr-3 font-mono ${e.passed ? 'text-ok' : 'text-warn'}`}>
                        {e.bestScore}
                        {e.passed ? ' ✓' : ''}
                      </td>
                      <td className="py-1.5 pr-3 font-mono">{e.taken}</td>
                      <td className="py-1.5 text-text2">{e.lastAt ? formatDate(e.lastAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
      {progress.nextNumber !== null && (
        <div>
          <button type="button" className="btn-secondary btn-sm" onClick={() => void start(progress.nextNumber as number)} disabled={busy !== null}>
            {busy !== null ? 'Préparation…' : `Passer le n° ${progress.nextNumber}, jamais passé →`}
          </button>
        </div>
      )}
      {error != null && <ErrorBox error={error} title="Impossible de lancer l'examen" />}
    </section>
  );
}
