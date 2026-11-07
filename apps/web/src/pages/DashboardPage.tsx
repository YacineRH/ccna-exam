import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { MasteryLegend, ProgressChart, RadarChart, ReadinessGauge, Sparkline } from '../components/charts';
import { IconPlay } from '../components/Icons';
import { AttemptRow } from '../components/AttemptRow';
import { EmptyState, ErrorBox, MasteryBar, MasteryValue, Spinner } from '../components/ui';
import {
  formatDate,
  formatDayHeader,
  formatDuration,
  formatNumber,
  formatPercent,
  greeting,
} from '../lib/format';
import type { AttemptSummary, Stats } from '../lib/types';
import { useApi } from '../lib/useApi';

const CERT = 'ccna';

function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="panel px-5 py-[18px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-muted">{title}</span>
        {aside && <span className="font-mono text-[11px] font-medium">{aside}</span>}
      </div>
      {children}
    </div>
  );
}

const LEVEL = {
  ready: { cls: 'pill-ok', label: 'PRÊT' },
  almost: { cls: 'pill-warn', label: 'PRESQUE PRÊT' },
  not_ready: { cls: 'pill-warn', label: 'PAS ENCORE PRÊT' },
} as const;

function trend30Days(scores: Stats['recentScores']): number | null {
  const since = Date.now() - 30 * 86_400_000;
  const recent = scores.filter((s) => new Date(s.submittedAt).getTime() >= since);
  if (recent.length < 2) return null;
  return (recent[recent.length - 1]?.scaledScore ?? 0) - (recent[0]?.scaledScore ?? 0);
}

function Readiness({ stats }: { stats: Stats }) {
  const { readiness, passingScore, scale, domains } = stats;
  const weakest = domains
    .filter((d) => d.percent !== null && d.percent < 80)
    .sort((a, b) => (a.percent ?? 0) - (b.percent ?? 0))
    .slice(0, 2);
  const weakWeight = Math.round(weakest.reduce((s, d) => s + d.weight, 0) * 100);
  const trend = trend30Days(stats.recentScores);
  const lvl = LEVEL[readiness.level];
  const gap = readiness.gap ?? 0;

  return (
    <section
      aria-label="Niveau de préparation"
      className="viewfinder relative flex flex-wrap items-center gap-8 rounded-2xl border border-line px-6 py-[26px] shadow-hero sm:px-[30px]"
      style={{ background: 'radial-gradient(120% 140% at 0% 0%, rgba(45,212,232,0.10), rgba(16,24,39,0.85) 45%)' }}
    >
      <ReadinessGauge estimate={readiness.estimate} passing={passingScore} max={scale.max} />
      <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="label-mono">Indice de préparation</span>
          {readiness.estimate !== null && (
            <span className={lvl.cls}>
              {lvl.label} · {gap >= 0 ? `+${gap}` : `−${Math.abs(gap)}`} PTS
            </span>
          )}
        </div>
        {readiness.estimate === null ? (
          <>
            <h2 className="text-[22px] font-semibold leading-snug">Pas encore d'estimation.</h2>
            <p className="max-w-[620px] text-text2">
              L'indice se calcule sur vos examens blancs terminés (moyenne pondérée des 5 derniers, les plus récents comptent
              davantage). Passez un premier examen blanc pour situer votre niveau par rapport au seuil de {passingScore}.
            </p>
            <div>
              <Link to="/examen/nouveau?mode=exam" className="btn-primary">
                <IconPlay /> Passer un premier examen blanc
              </Link>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-[22px] font-semibold leading-snug">
              {gap >= 0
                ? `Au-dessus du seuil de ${gap} point${gap > 1 ? 's' : ''} : gardez le rythme.`
                : `Encore ${Math.abs(gap)} points pour franchir le seuil de ${passingScore}.`}
            </h2>
            <p className="max-w-[620px] text-text2">
              Moyenne pondérée {readiness.examsConsidered > 1 ? `des ${readiness.examsConsidered} derniers examens blancs` : 'de votre examen blanc'}.
              {weakest.length > 0 && (
                <>
                  {' '}
                  {weakest.length > 1 ? 'Les deux leviers les plus rentables' : 'Le levier le plus rentable'} :{' '}
                  {weakest.map((d, i) => (
                    <span key={d.code}>
                      {i > 0 && ' et '}
                      <Link to={`/examen/nouveau?mode=practice&domaines=${d.code}`}>{d.name}</Link> ({formatPercent(d.percent ?? 0)})
                    </span>
                  ))}
                  , {weakest.length > 1 ? 'qui pèsent ensemble' : 'qui pèse'} {weakWeight} % de l'examen.
                </>
              )}
            </p>
          </>
        )}
        <div className="flex flex-wrap gap-5 font-mono text-[12px] font-medium text-muted">
          <span className="flex items-center gap-2">
            <span className="h-1 w-3.5 rounded-sm bg-accent" />
            actuel {readiness.estimate ?? '—'}
          </span>
          <span className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full border-2 border-ok" />
            seuil {passingScore}
          </span>
          {trend !== null && (
            <span className={trend >= 0 ? 'text-ok' : 'text-crit'}>
              {trend >= 0 ? '▲ +' : '▼ −'}
              {Math.abs(trend)} sur 30 jours
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

function Indicators({ stats }: { stats: Stats }) {
  const scores = stats.recentScores.map((s) => s.scaledScore);
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const okRate = stats.questions.answered ? (stats.questions.correct / stats.questions.answered) * 100 : null;
  return (
    <section aria-label="Indicateurs" className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
      <Card title="Score moyen" aside={scores.length ? <span className="text-muted">{scores.length} ex.</span> : undefined}>
        <div className="mt-2 flex items-end justify-between gap-2">
          <span className="font-mono text-[28px] font-semibold">{avg ?? '—'}</span>
          <Sparkline values={scores} min={stats.scale.min} max={stats.scale.max} />
        </div>
      </Card>
      <Card title="Examens blancs terminés">
        <div className="mt-2 font-mono text-[28px] font-semibold">{stats.exams.taken}</div>
        <div className="mt-1 font-mono text-[12px] text-muted">
          {stats.exams.lastAt ? `dernier le ${formatDate(stats.exams.lastAt)}` : 'aucun pour l’instant'}
        </div>
      </Card>
      <Card
        title="Questions traitées"
        aside={okRate !== null ? <span className="text-muted">{formatPercent(okRate)} ok</span> : undefined}
      >
        <div className="mt-2 font-mono text-[28px] font-semibold">{formatNumber(stats.questions.answered)}</div>
        <div className="mt-2 h-1 rounded-sm bg-raised" aria-hidden>
          <div className="h-full rounded-sm bg-accent" style={{ width: `${okRate ?? 0}%` }} />
        </div>
      </Card>
      <Card title="Temps d'entraînement">
        <div className="mt-2 font-mono text-[28px] font-semibold">{stats.totalSeconds ? formatDuration(stats.totalSeconds) : '—'}</div>
        <div className="mt-1 font-mono text-[12px] text-muted">cumulé, examens et entraînement</div>
      </Card>
    </section>
  );
}

function DomainsPanel({ stats }: { stats: Stats }) {
  const threshold = (stats.passingScore / stats.scale.max) * 100;
  const anyData = stats.domains.some((d) => d.percent !== null);
  return (
    <section aria-labelledby="radar-h" className="panel px-6 py-[22px]">
      <div className="flex items-center justify-between gap-3">
        <h2 id="radar-h" className="text-base font-semibold">
          Maîtrise par domaine
        </h2>
        <span className="font-mono text-[11px] font-medium text-ok">- - seuil {formatPercent(threshold, 1)}</span>
      </div>
      {anyData ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2">
          <RadarChart data={stats.domains} threshold={threshold} />
          <div className="flex-[1_1_160px]">
            <MasteryLegend />
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <EmptyState title="Aucune réponse corrigée pour l'instant.">
            La maîtrise par domaine se remplit au fil de vos examens et entraînements.
          </EmptyState>
        </div>
      )}
    </section>
  );
}

function OfficialDomains({ stats }: { stats: Stats }) {
  return (
    <section aria-labelledby="dom-h" className="panel px-6 py-[22px]">
      <h2 id="dom-h" className="mb-3.5 text-base font-semibold">
        Domaines officiels
      </h2>
      <ul className="flex flex-col">
        {stats.domains.map((d) => (
          <li
            key={d.code}
            className="grid min-h-[44px] items-center gap-3 border-b border-raised py-1.5 [grid-template-columns:36px_1fr_auto] sm:[grid-template-columns:36px_1fr_44px_110px_56px]"
          >
            <span className="font-mono text-[12px] font-semibold text-muted">{d.code}</span>
            <span className="min-w-0">
              <span className="block truncate">{d.name}</span>
              <span className="font-mono text-[11px] text-muted sm:hidden">
                {Math.round(d.weight * 100)} % · {d.answered} rép.
              </span>
            </span>
            <span className="hidden font-mono text-[11px] font-medium text-muted sm:block">{Math.round(d.weight * 100)} %</span>
            <span className="hidden sm:block" title={`${d.correct}/${d.answered} bonnes réponses`}>
              <MasteryBar percent={d.percent} />
            </span>
            <MasteryValue percent={d.percent} className="text-right text-[13px]" />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ToReview({ stats }: { stats: Stats }) {
  const names = new Map(stats.domains.map((d) => [d.code, d.name]));
  return (
    <section aria-labelledby="todo-h" className="panel px-6 py-[22px]">
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <h2 id="todo-h" className="text-base font-semibold">
          À revoir · priorisé
        </h2>
        <span className="font-mono text-[11px] font-medium text-muted">erreurs des 30 derniers jours</span>
      </div>
      {stats.toReview.length === 0 ? (
        <EmptyState title="Rien à revoir pour l'instant.">
          Les sous-thèmes où vous vous trompez le plus apparaîtront ici, triés par nombre d'erreurs.
        </EmptyState>
      ) : (
        <ol className="flex flex-col gap-2">
          {stats.toReview.map((t, i) => {
            const ratio = t.answered ? t.errors / t.answered : 0;
            const crit = ratio >= 0.5;
            const isSubnet = t.subtopic === '1.6';
            return (
              <li key={`${t.domain}-${t.subtopic ?? i}`} className="flex flex-wrap items-center gap-3.5 rounded-[10px] border border-[#1A2539] bg-well px-3.5 py-3">
                <span
                  className="flex h-[34px] w-[34px] items-center justify-center rounded-lg font-mono text-[12px] font-semibold"
                  style={{
                    background: crit ? 'rgba(255,107,94,.12)' : 'rgba(245,181,68,.12)',
                    color: crit ? '#FF6B5E' : '#F5B544',
                  }}
                  aria-label={`Priorité ${i + 1}${crit ? ', critique' : ''}`}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0 flex-[1_1_160px]">
                  <span className="block font-medium">{t.subtopicName ?? names.get(t.domain) ?? t.domain}</span>
                  <span className="font-mono text-[12px] text-muted">
                    {t.subtopic ?? t.domain} · {t.errors}/{t.answered} erreur{t.errors > 1 ? 's' : ''}
                  </span>
                </span>
                {isSubnet ? (
                  <Link to="/labs/subnetting" className="btn-secondary btn-sm">
                    Trainer →
                  </Link>
                ) : (
                  <Link to={`/examen/nouveau?mode=practice&domaines=${t.domain}`} className="btn-secondary btn-sm">
                    S'entraîner →
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function RecentAttempts({ attempts }: { attempts: AttemptSummary[] }) {
  const shown = attempts.slice(0, 5);
  return (
    <section aria-labelledby="last-h" className="panel px-6 py-[22px]">
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <h2 id="last-h" className="text-base font-semibold">
          Dernières sessions
        </h2>
        {attempts.length > 0 && <Link to="/historique" className="font-mono text-[12px]">Tout l'historique →</Link>}
      </div>
      {shown.length === 0 ? (
        <EmptyState title="Aucune session pour l'instant." action={<Link to="/examen/nouveau?mode=practice" className="btn-secondary btn-sm">Démarrer un entraînement</Link>}>
          Vos examens blancs et entraînements apparaîtront ici.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((a) => (
            <AttemptRow key={a.id} attempt={a} compact />
          ))}
        </ul>
      )}
    </section>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const stats = useApi<Stats>(`/stats?certification=${CERT}`);
  const attempts = useApi<{ attempts: AttemptSummary[] }>('/attempts');
  const now = new Date();
  const firstName = user?.displayName.split(/\s+/)[0] ?? '';

  return (
    <>
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-[1_1_320px]">
          <div className="font-mono text-[12px] font-medium tracking-[0.6px] text-muted">
            <span className="text-accent">●</span> {formatDayHeader(now)}
            {stats.data ? ` · ${stats.data.exams.taken} EXAMEN${stats.data.exams.taken > 1 ? 'S' : ''} BLANC${stats.data.exams.taken > 1 ? 'S' : ''}` : ''}
          </div>
          <h1 className="mt-1.5 text-[28px] font-semibold leading-tight sm:text-[34px]">
            {greeting(now)} {firstName},{' '}
            <span className="text-muted">on vise {stats.data?.passingScore ?? 825}.</span>
          </h1>
        </div>
        <Link
          to="/examen/nouveau?mode=practice"
          className="btn-secondary h-[46px] rounded-[10px]"
          style={{ background: 'rgba(16,24,39,.7)' }}
        >
          Entraînement ciblé
        </Link>
        <Link to="/examen/nouveau?mode=exam" className="btn-primary h-[46px] rounded-[10px]">
          <IconPlay /> Lancer un examen blanc
        </Link>
      </div>

      {stats.loading && !stats.data && <Spinner label="Chargement des statistiques…" />}
      {stats.error != null && <ErrorBox error={stats.error} onRetry={stats.reload} title="Statistiques indisponibles" />}

      {stats.data && (
        <>
          <Readiness stats={stats.data} />
          <Indicators stats={stats.data} />
          <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))]">
            <DomainsPanel stats={stats.data} />
            <section aria-labelledby="prog-h" className="panel flex flex-col px-6 py-[22px]">
              {stats.data.recentScores.length === 0 ? (
                <>
                  <h2 id="prog-h" className="text-base font-semibold">
                    Progression
                  </h2>
                  <div className="mt-4">
                    <EmptyState title="Pas encore de courbe.">
                      Chaque examen blanc terminé ajoute un point ; la ligne verte matérialise le seuil de {stats.data.passingScore}.
                    </EmptyState>
                  </div>
                </>
              ) : (
                <ProgressChart
                  scores={stats.data.recentScores}
                  passing={stats.data.passingScore}
                  min={stats.data.scale.min}
                  max={stats.data.scale.max}
                />
              )}
            </section>
          </div>
          <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))]">
            <OfficialDomains stats={stats.data} />
            <ToReview stats={stats.data} />
          </div>
        </>
      )}

      {attempts.error != null && <ErrorBox error={attempts.error} onRetry={attempts.reload} title="Sessions indisponibles" />}
      {attempts.data && <RecentAttempts attempts={attempts.data.attempts} />}
    </>
  );
}
