import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DistractorNotes, ReviewAnswer } from '../components/answers/ReviewAnswer';
import { Exhibit } from '../components/answers/Exhibit';
import { MODE_LABEL } from '../components/AttemptRow';
import { EmptyState, ErrorBox, MasteryBar, Spinner } from '../components/ui';
import { formatDateTime, formatDuration, formatHms, formatPercent, MASTERY_HEX, masteryOf, shortDomain } from '../lib/format';
import { QUESTION_TYPE_LABEL } from '../lib/responses';
import type { AttemptResult, CertificationDetail, ReviewItem } from '../lib/types';
import { useApi } from '../lib/useApi';

type Filter = 'wrong' | 'flagged' | 'all';

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-[10px] border border-[#1A2539] bg-chrome px-4 py-3.5">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="whitespace-nowrap font-mono text-[22px] font-semibold" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}

function ReviewCard({
  item,
  domainName,
  open,
  onToggle,
}: {
  item: ReviewItem;
  domainName: string | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  const status = item.isCorrect ? 'ok' : 'crit';
  const panelId = `q-${item.questionId}`;
  return (
    <article className={`overflow-hidden rounded-[10px] border ${open ? 'border-line2' : 'border-[#223049]'}`}>
      <h3 className="m-0 font-sans text-[14px] font-normal">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex min-h-[48px] w-full flex-wrap items-center gap-3 bg-chrome px-4 py-3 text-left hover:bg-[#0F1828]"
        >
          <span className="font-mono text-[13px] font-semibold" style={{ color: MASTERY_HEX[status] }}>
            Q{item.position + 1} {item.isCorrect ? '✓' : '✕'}
            <span className="sr-only">{item.isCorrect ? ' bonne réponse' : ' réponse fausse'}</span>
          </span>
          <span className="line-clamp-2 min-w-0 flex-[1_1_300px] font-medium">{item.body.stem}</span>
          <span className="font-mono text-[11px] font-medium text-muted">
            {item.domain} {domainName ?? ''} · {QUESTION_TYPE_LABEL[item.body.type].toLowerCase()} · {formatDuration(item.secondsSpent)}
            {item.flagged ? ' · ' : ''}
            {item.flagged && <span className="text-warn">marquée</span>}
          </span>
        </button>
      </h3>
      {open && (
        <div id={panelId} className="flex flex-col gap-4 p-4">
          {item.body.exhibit && <Exhibit text={item.body.exhibit} />}
          <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))]">
            <ReviewAnswer body={item.body} answerKey={item.key} response={item.response} />
            <div className="text-[14px] text-[#C9D4E5]">
              <div className="label-mono mb-1.5 tracking-[1px]">Explication</div>
              <p className="m-0 mb-2 whitespace-pre-line">{item.explanation}</p>
              <DistractorNotes body={item.body} notes={item.distractorNotes} />
              {item.reference && (
                <div className="mt-3.5 font-mono text-[12px] text-muted">réf. {item.reference}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

export function ResultPage() {
  const { id = '' } = useParams();
  const result = useApi<AttemptResult>(`/attempts/${id}/result`);
  const cert = useApi<CertificationDetail>(result.data ? `/certifications/${result.data.certification}` : null);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [openIds, setOpenIds] = useState<Set<string> | null>(null);

  const domains = useMemo(() => new Map((cert.data?.certification.domains ?? []).map((d) => [d.code, d])), [cert.data]);

  if (result.loading && !result.data) return <Spinner label="Chargement des résultats…" />;
  if (result.error != null || !result.data) {
    return (
      <div className="flex flex-col gap-4">
        <ErrorBox error={result.error} onRetry={result.reload} title="Résultats indisponibles" />
        <Link to="/historique" className="font-mono text-[12px]">← Historique</Link>
      </div>
    );
  }

  const r = result.data;
  const wrong = r.review.filter((q) => !q.isCorrect);
  const flagged = r.review.filter((q) => q.flagged);
  const active: Filter = filter ?? (wrong.length ? 'wrong' : 'all');
  const list = active === 'wrong' ? wrong : active === 'flagged' ? flagged : r.review;
  const opened = openIds ?? new Set(list[0] ? [list[0].questionId] : []);
  const toggle = (qid: string) => {
    const next = new Set(opened);
    if (next.has(qid)) next.delete(qid);
    else next.add(qid);
    setOpenIds(next);
  };

  const scale = cert.data?.certification.scoring;
  const max = scale?.max ?? 1000;
  const isExam = r.mode === 'exam';
  const passed = !!r.passed;
  const tone = passed ? '#3DDC97' : '#FF6B5E';
  const margin = (r.scaledScore ?? 0) - r.passingScore;
  const answered = r.review.filter((q) => q.response !== null).length;
  const scored = (r.domainScores ?? []).filter((d) => d.total > 0);
  const weakest = scored.length ? scored.reduce((a, b) => (b.percent < a.percent ? b : a)) : null;
  const thresholdPct = (r.passingScore / max) * 100;

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6">
      <nav aria-label="Fil d'Ariane" className="flex flex-wrap items-center gap-3 font-mono text-[12px] font-medium text-muted">
        <Link to="/">← Tableau de bord</Link>
        <span aria-hidden>/</span>
        <Link to="/historique">Historique</Link>
        <span aria-hidden>/</span>
        <span className="text-text" aria-current="page">
          {MODE_LABEL[r.mode]} du {formatDateTime(r.startedAt)}
        </span>
      </nav>

      <section
        aria-label="Score"
        className="viewfinder relative flex flex-wrap items-center gap-8 rounded-2xl border border-line px-6 py-[30px] shadow-hero sm:px-[34px]"
        style={{
          background: `radial-gradient(120% 160% at 0% 0%, ${passed ? 'rgba(61,220,151,0.12)' : 'rgba(255,107,94,0.12)'}, rgba(16,24,39,0.88) 45%)`,
          ['--vf' as string]: tone,
        }}
      >
        <div>
          <div className="label-mono tracking-[1.2px]">Score final</div>
          <div className="flex items-baseline gap-2.5">
            <span className="font-mono text-[56px] font-semibold leading-[1.1] tracking-[-3px] sm:text-[72px]">{r.scaledScore ?? '—'}</span>
            <span className="font-mono text-[20px] font-medium text-muted">/ {max}</span>
          </div>
          <div className={`mt-1.5 ${passed ? 'pill-ok' : 'pill-crit'} px-3 py-1 text-[12px] tracking-[0.4px]`}>
            {passed ? '✓ ADMIS' : '✕ NON ADMIS'} · {margin >= 0 ? `+${margin}` : `−${Math.abs(margin)}`} pts{' '}
            {margin >= 0 ? 'au-dessus du' : 'sous le'} seuil ({r.passingScore})
          </div>
          {!isExam && <div className="mt-2 font-mono text-[11px] text-muted">Entraînement : score indicatif, hors indice de préparation.</div>}
          {r.status === 'expired' && <div className="mt-2 font-mono text-[11px] text-warn">▲ Soumis automatiquement à la fin du temps imparti.</div>}
        </div>
        <div className="grid flex-[1_1_420px] gap-3 [grid-template-columns:repeat(auto-fit,minmax(140px,1fr))]">
          <Stat label="Bonnes réponses" value={`${r.correctCount ?? 0} / ${r.totalCount}`} />
          <Stat label="Durée" value={formatHms(r.totalSeconds)} />
          <Stat label="Temps moyen / q." value={answered ? `${Math.round(r.totalSeconds / Math.max(1, r.totalCount))} s` : '—'} />
          <Stat
            label={weakest ? `Domaine faible · ${Math.round(weakest.percent)} %` : 'Domaine faible'}
            value={weakest ? `${weakest.domain} ${shortDomain(weakest.domain, domains.get(weakest.domain)?.name ?? '')}` : '—'}
            {...(weakest ? { color: MASTERY_HEX[masteryOf(weakest.percent)] } : {})}
          />
        </div>
        <div className="flex flex-col gap-2">
          {r.review.length > 0 && (
            <a href="#post-mortem" className="btn-primary">
              Post-mortem
            </a>
          )}
          <Link to={`/examen/nouveau?mode=${r.mode}`} className="btn-secondary">
            {isExam ? 'Nouvel examen' : 'Nouvel entraînement'}
          </Link>
        </div>
      </section>

      {r.suspicious && (
        <div role="note" className="rounded-[10px] border px-4 py-3 text-[13px] text-text2" style={{ borderColor: 'rgba(245,181,68,.4)', background: 'rgba(245,181,68,.06)' }}>
          <span className="font-mono font-semibold text-warn">▲ Rythme inhabituel</span> : moins de 5 s par question en moyenne.
          Ce score est peu représentatif de votre niveau.
        </div>
      )}

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr))]">
        <section aria-labelledby="d-h" className="panel-deep rounded-xl px-6 py-[22px]">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="d-h" className="text-[15px] font-semibold">
              Score par domaine
            </h2>
            <span className="font-mono text-[11px] text-muted">repère blanc = seuil {formatPercent(thresholdPct, 1)}</span>
          </div>
          {scored.length === 0 ? (
            <EmptyState title="Aucun domaine noté." />
          ) : (
            <div className="flex flex-col gap-3.5">
              {(r.domainScores ?? []).filter((d) => d.total > 0).map((d) => {
                const color = MASTERY_HEX[masteryOf(d.percent)];
                return (
                  <div key={d.domain}>
                    <div className="mb-1.5 flex justify-between gap-3">
                      <span>
                        {d.domain} {domains.get(d.domain)?.name ?? ''}
                      </span>
                      <span className="font-mono text-[13px] font-medium" style={{ color }}>
                        {masteryOf(d.percent) === 'ok' ? '✓' : masteryOf(d.percent) === 'warn' ? '▲' : '✕'} {Math.round(d.percent)} %{' '}
                        <span className="text-muted">· {d.correct}/{d.total}</span>
                      </span>
                    </div>
                    <MasteryBar percent={d.percent} marker={thresholdPct} />
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section aria-labelledby="t-h" className="panel-deep flex flex-col rounded-xl px-6 py-[22px]">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="t-h" className="text-[15px] font-semibold">
              Temps par question
            </h2>
            <span className="font-mono text-[11px] font-medium text-muted">barre rouge = réponse fausse</span>
          </div>
          <TimeBars review={r.review} />
        </section>
      </div>

      <section id="post-mortem" aria-labelledby="r-h" className="panel-deep scroll-mt-20 rounded-xl px-4 py-[22px] sm:px-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="r-h" className="text-[15px] font-semibold">
            Post-mortem · {wrong.length} réponse{wrong.length > 1 ? 's' : ''} fausse{wrong.length > 1 ? 's' : ''}
          </h2>
          <div role="group" aria-label="Filtre" className="flex flex-wrap gap-1.5 font-mono text-[12px] font-medium">
            {(
              [
                ['wrong', `Fausses (${wrong.length})`],
                ['flagged', `Marquées (${flagged.length})`],
                ['all', `Toutes (${r.review.length})`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={active === k}
                onClick={() => {
                  setFilter(k);
                  setOpenIds(null);
                }}
                className={`min-h-[44px] rounded-md border px-3 ${
                  active === k ? 'border-line2 bg-raised text-text' : 'border-[#223049] bg-transparent text-muted hover:text-text'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {list.length === 0 ? (
          <EmptyState title={active === 'wrong' ? 'Aucune réponse fausse : sans faute !' : 'Aucune question marquée.'} />
        ) : (
          <div className="flex flex-col gap-2">
            {list.map((item) => (
              <ReviewCard
                key={item.questionId}
                item={item}
                domainName={domains.get(item.domain)?.name}
                open={opened.has(item.questionId)}
                onToggle={() => toggle(item.questionId)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function TimeBars({ review }: { review: ReviewItem[] }) {
  if (review.length === 0) return null;
  const longest = Math.max(...review.map((q) => q.secondsSpent));
  const maxT = Math.max(30, longest);
  const slow = review.filter((q) => q.secondsSpent > 120).length;
  const mid = Math.ceil(review.length / 2);
  return (
    <>
      <div
        role="img"
        aria-label={`Temps par question, de 1 à ${review.length}, réponses fausses en rouge`}
        className="mt-[18px] flex min-h-[180px] flex-1 items-end gap-0.5 border-b border-[#223049]"
      >
        {review.map((q) => (
          <span
            key={q.questionId}
            title={`Q${q.position + 1} · ${formatDuration(q.secondsSpent)} · ${q.isCorrect ? 'juste' : 'fausse'}`}
            className="flex-1 rounded-t-[1px]"
            style={{
              height: `${Math.max(2, (q.secondsSpent / maxT) * 100)}%`,
              background: q.isCorrect ? '#2B5468' : '#FF6B5E',
              maxWidth: 28,
            }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[11px] font-medium text-muted">
        <span>Q1</span>
        {review.length > 2 && <span>Q{mid}</span>}
        <span>Q{review.length}</span>
      </div>
      <p className="mt-3 text-[13px] text-text2">
        {slow > 0
          ? `${slow} question${slow > 1 ? 's' : ''} au-delà de 2 min.`
          : 'Aucune question au-delà de 2 min.'}{' '}
        Temps le plus long : {formatDuration(longest)}.
      </p>
    </>
  );
}
