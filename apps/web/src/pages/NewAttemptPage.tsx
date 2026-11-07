import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { IconPlay, IconTimer, IconTrend } from '../components/Icons';
import { ErrorBox, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { examMinutes, maxFeasibleCount, planShortfalls } from '../lib/planning';
import type { AttemptMode, AttemptState, CertificationDetail, InsufficientQuestionsDetails } from '../lib/types';
import { useApi } from '../lib/useApi';

const CERT = 'ccna';

function ModeCard({
  mode,
  checked,
  onChange,
  title,
  description,
  icon,
}: {
  mode: AttemptMode;
  checked: boolean;
  onChange: (m: AttemptMode) => void;
  title: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <label
      className="flex min-h-[44px] cursor-pointer gap-3.5 rounded-xl border px-4 py-4 transition-colors"
      style={{
        background: checked ? 'rgba(45,212,232,0.08)' : '#101827',
        borderColor: checked ? '#2DD4E8' : '#223049',
      }}
    >
      <input
        type="radio"
        name="mode"
        value={mode}
        checked={checked}
        onChange={() => onChange(mode)}
        className="mt-1 h-[18px] w-[18px] shrink-0 accent-accent"
      />
      <span className="flex flex-col gap-1">
        <span className="flex items-center gap-2 font-medium">
          <span className={checked ? 'text-accent' : 'text-muted'}>{icon}</span>
          {title}
        </span>
        <span className="text-[13px] text-text2">{description}</span>
      </span>
    </label>
  );
}

export function NewAttemptPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const detail = useApi<CertificationDetail>(`/certifications/${CERT}`);

  const urlMode: AttemptMode = params.get('mode') === 'practice' ? 'practice' : 'exam';
  const urlDomains = params.get('domaines');
  const [mode, setMode] = useState<AttemptMode>(urlMode);
  const [count, setCount] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Le menu latéral change ?mode= : on suit.
  useEffect(() => setMode(urlMode), [urlMode]);
  useEffect(() => {
    setSelected(urlDomains ? urlDomains.split(',').filter(Boolean) : null);
  }, [urlDomains]);

  const cert = detail.data?.certification;
  const bank = detail.data?.bank;
  const allCodes = useMemo(() => cert?.domains.map((d) => d.code) ?? [], [cert]);
  const chosen = selected ?? allCodes;
  const chosenDomains = useMemo(() => (cert?.domains ?? []).filter((d) => chosen.includes(d.code)), [cert, chosen]);
  const maxPossible = useMemo(
    () => (bank ? maxFeasibleCount(chosenDomains, bank.byDomain, Math.min(200, bank.questions)) : 0),
    [chosenDomains, bank],
  );
  const official = cert?.examFormat.questionCount ?? 102;
  const defaultCount = mode === 'exam' ? official : 10;
  const effectiveCount = count ?? (maxPossible ? Math.min(defaultCount, maxPossible) : defaultCount);
  const shortfalls = bank ? planShortfalls(chosenDomains, bank.byDomain, effectiveCount) : [];
  const domainName = (code: string) => cert?.domains.find((d) => d.code === code)?.name ?? code;

  if (detail.loading && !detail.data) return <Spinner label="Chargement de la certification…" />;
  if (detail.error != null || !cert || !bank) return <ErrorBox error={detail.error} onRetry={detail.reload} title="Certification indisponible" />;

  const changeMode = (m: AttemptMode) => {
    setMode(m);
    setCount(null);
    setError(null);
    const next = new URLSearchParams(params);
    next.set('mode', m);
    setParams(next, { replace: true });
  };

  const toggleDomain = (code: string) => {
    setError(null);
    setSelected(chosen.includes(code) ? chosen.filter((c) => c !== code) : [...chosen, code]);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || chosen.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const all = chosen.length === allCodes.length;
      const attempt = await api<AttemptState>('/attempts', {
        method: 'POST',
        body: {
          certification: CERT,
          mode,
          questionCount: effectiveCount,
          ...(all ? {} : { domains: chosen }),
        },
      });
      navigate(`/tentatives/${attempt.id}`);
    } catch (err) {
      setError(err);
      setSubmitting(false);
    }
  };

  const insufficient =
    error instanceof ApiError && error.code === 'insufficient_questions' ? (error.details as InsufficientQuestionsDetails | undefined) : undefined;

  return (
    <form onSubmit={submit} className="mx-auto flex w-full max-w-[980px] flex-col gap-[22px]" noValidate>
      <div>
        <div className="font-mono text-[12px] font-medium tracking-[0.6px] text-muted">
          <span className="text-accent">●</span> {cert.vendor.toUpperCase()} {cert.examCode} · BANQUE : {bank.questions} QUESTION{bank.questions > 1 ? 'S' : ''}
        </div>
        <h1 className="mt-1.5 text-[28px] font-semibold leading-tight sm:text-[34px]">Nouvelle session</h1>
      </div>

      <fieldset className="panel m-0 flex flex-col gap-3 px-5 py-5 sm:px-6">
        <legend className="sr-only">Mode</legend>
        <div className="label-mono" aria-hidden>
          Mode
        </div>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))]">
          <ModeCard
            mode="exam"
            checked={mode === 'exam'}
            onChange={changeMode}
            icon={<IconTimer />}
            title="Examen blanc chronométré"
            description={`Conditions du jour J : chrono, ${cert.examFormat.allowBackNavigation ? 'retour arrière autorisé' : 'pas de retour arrière'}, correction à la fin. Compte pour l'indice de préparation.`}
          />
          <ModeCard
            mode="practice"
            checked={mode === 'practice'}
            onChange={changeMode}
            icon={<IconTrend />}
            title="Entraînement libre"
            description="Sans chrono, navigation libre, correction et explications après chaque question."
          />
        </div>
      </fieldset>

      <fieldset className="panel m-0 flex flex-col gap-3 px-5 py-5 sm:px-6">
        <legend className="sr-only">Nombre de questions</legend>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <label htmlFor="count" className="label-mono">
            Nombre de questions
          </label>
          <span className="font-mono text-[12px] text-muted">
            format officiel : {official} questions · {cert.examFormat.durationMinutes} min
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="field w-[140px]">
            <input
              id="count"
              type="number"
              inputMode="numeric"
              min={1}
              max={200}
              value={effectiveCount}
              onChange={(e) => {
                setError(null);
                const v = Math.round(Number(e.target.value));
                setCount(Number.isFinite(v) ? Math.min(200, Math.max(1, v)) : 1);
              }}
              className="input-bare font-mono text-lg font-semibold"
              aria-describedby="count-help"
            />
          </span>
          <div role="group" aria-label="Préréglages" className="flex flex-wrap gap-1.5">
            {[...new Set([5, 10, 20, maxPossible, official])]
              .filter((n) => n > 0)
              .sort((a, b) => a - b)
              .map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={effectiveCount === n}
                  onClick={() => {
                    setError(null);
                    setCount(n);
                  }}
                  className={`min-h-[44px] min-w-[44px] rounded-lg border px-3 font-mono text-[13px] ${
                    effectiveCount === n ? 'border-accent bg-[rgba(45,212,232,.08)] text-text' : 'border-line2 text-text2 hover:bg-raised'
                  }`}
                >
                  {n}
                  {n === official ? ' · officiel' : n === maxPossible && n !== official ? ' · max' : ''}
                </button>
              ))}
          </div>
        </div>
        <p id="count-help" className="m-0 text-[13px] text-text2">
          {mode === 'exam' ? (
            <>
              Durée accordée : <span className="font-mono text-text">{examMinutes(effectiveCount, cert.examFormat)} min</span> (proportionnelle au
              format officiel).{' '}
            </>
          ) : null}
          La banque permet au plus <span className="font-mono text-text">{maxPossible}</span> question{maxPossible > 1 ? 's' : ''} avec les domaines
          retenus (répartition selon la pondération officielle).
        </p>
      </fieldset>

      <fieldset className="panel m-0 flex flex-col gap-3 px-5 py-5 sm:px-6">
        <legend className="sr-only">Domaines</legend>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="label-mono" aria-hidden>
            Domaines
          </span>
          <div className="flex gap-1.5">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setSelected(null)} disabled={chosen.length === allCodes.length}>
              Tout cocher
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setSelected([])} disabled={chosen.length === 0}>
              Tout décocher
            </button>
          </div>
        </div>
        <ul className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))]">
          {cert.domains.map((d) => {
            const on = chosen.includes(d.code);
            const n = bank.byDomain[d.code] ?? 0;
            return (
              <li key={d.code}>
                <label
                  className="flex min-h-[52px] cursor-pointer items-center gap-3 rounded-[10px] border px-3.5 py-2.5"
                  style={{ borderColor: on ? '#2B3B57' : '#1A2539', background: on ? '#0F1828' : 'transparent' }}
                >
                  <input type="checkbox" checked={on} onChange={() => toggleDomain(d.code)} className="h-[18px] w-[18px] shrink-0 accent-accent" />
                  <span className="w-8 shrink-0 font-mono text-[12px] font-semibold text-muted">{d.code}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block">{d.name}</span>
                    <span className="font-mono text-[11px] text-muted">
                      poids {Math.round(d.weight * 100)} % · {n} question{n > 1 ? 's' : ''} en banque
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {chosen.length === 0 && <p className="m-0 font-mono text-[12px] text-warn">▲ Cochez au moins un domaine.</p>}
      </fieldset>

      {shortfalls.length > 0 && !insufficient && (
        <div role="status" className="flex flex-col gap-2 rounded-[10px] border px-4 py-3 text-[13.5px]" style={{ borderColor: 'rgba(245,181,68,.4)', background: 'rgba(245,181,68,.06)' }}>
          <div className="font-mono text-[12px] font-semibold text-warn">▲ BANQUE INSUFFISANTE POUR {effectiveCount} QUESTIONS</div>
          <ul className="m-0 list-none p-0 text-text2">
            {shortfalls.map((s) => (
              <li key={s.domain}>
                {s.domain} {domainName(s.domain)} : {s.needed} demandée{s.needed > 1 ? 's' : ''}, {s.available} disponible{s.available > 1 ? 's' : ''}
              </li>
            ))}
          </ul>
          {maxPossible > 0 && (
            <div>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setCount(maxPossible)}>
                Ajuster à {maxPossible} question{maxPossible > 1 ? 's' : ''}
              </button>
            </div>
          )}
        </div>
      )}

      {insufficient && (
        <div role="alert" className="flex flex-col gap-2 rounded-[10px] border px-4 py-3 text-[13.5px]" style={{ borderColor: 'rgba(255,107,94,.45)', background: 'rgba(255,107,94,.07)' }}>
          <div className="font-mono text-[12px] font-semibold text-crit">✕ PAS ASSEZ DE QUESTIONS DANS LA BANQUE</div>
          <p className="m-0 text-text2">
            Le domaine <strong className="text-text">{insufficient.domain} {domainName(insufficient.domain)}</strong> demande{' '}
            <span className="font-mono text-text">{insufficient.needed}</span> question{insufficient.needed > 1 ? 's' : ''} mais seulement{' '}
            <span className="font-mono text-text">{insufficient.available}</span> {insufficient.available > 1 ? 'sont disponibles' : 'est disponible'}{' '}
            (banque publiée : {insufficient.poolSize} questions). Réduisez le nombre de questions ou retirez ce domaine.
          </p>
          {maxPossible > 0 && (
            <div>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => {
                  setCount(maxPossible);
                  setError(null);
                }}
              >
                Ajuster à {maxPossible} question{maxPossible > 1 ? 's' : ''}
              </button>
            </div>
          )}
        </div>
      )}
      {error != null && !insufficient && <ErrorBox error={error} title="Impossible de démarrer la session" />}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Link to="/" className="btn-secondary">
          Annuler
        </Link>
        <button type="submit" className="btn-primary" disabled={submitting || chosen.length === 0}>
          <IconPlay />
          {submitting ? 'Préparation…' : mode === 'exam' ? "Démarrer l'examen blanc" : "Démarrer l'entraînement"}
        </button>
      </div>
    </form>
  );
}
