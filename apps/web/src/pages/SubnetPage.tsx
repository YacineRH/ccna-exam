import { generateSubnetExercise } from '@examforge/core';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { formatStopwatch } from '../lib/format';
import {
  checkAll,
  emptyAnswers,
  OCTET_ORDINAL,
  octetBreakdown,
  SUBNET_FIELDS,
  type FieldCheck,
  type SubnetAnswers,
  type SubnetFieldId,
} from '../lib/subnet';

interface Done {
  label: string;
  prefix: number;
  ok: boolean;
  ms: number | null;
}

const newSeed = () => Math.floor(Math.random() * 2 ** 31);
const TARGET_SECONDS = 15;

function readTimed(): boolean {
  try {
    return localStorage.getItem('subnet.timed') !== '0';
  } catch {
    return true;
  }
}

export function SubnetPage() {
  const [seed, setSeed] = useState(newSeed);
  const [count, setCount] = useState(1);
  const exercise = useMemo(() => generateSubnetExercise(seed), [seed]);
  const [answers, setAnswers] = useState<SubnetAnswers>(emptyAnswers);
  const [checks, setChecks] = useState<Record<SubnetFieldId, FieldCheck> | null>(null);
  const [showMethod, setShowMethod] = useState(false);
  const [timed, setTimed] = useState(readTimed);
  const [history, setHistory] = useState<Done[]>([]);
  const [startedAt, setStartedAt] = useState(() => performance.now());
  const [elapsed, setElapsed] = useState(0);
  const [finalMs, setFinalMs] = useState<number | null>(null);
  const firstInput = useRef<HTMLInputElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);

  const solved = checks !== null;
  const allOk = solved && Object.values(checks).every((c) => c.ok);

  useEffect(() => {
    if (!timed || solved) return;
    const t = setInterval(() => setElapsed(performance.now() - startedAt), 100);
    return () => clearInterval(t);
  }, [timed, solved, startedAt]);

  useEffect(() => {
    try {
      localStorage.setItem('subnet.timed', timed ? '1' : '0');
    } catch {
      /* stockage indisponible : préférence non mémorisée */
    }
  }, [timed]);

  const validate = (e: FormEvent) => {
    e.preventDefault();
    if (solved) {
      next();
      return;
    }
    const result = checkAll(exercise.answer, answers);
    const ms = performance.now() - startedAt;
    setChecks(result);
    setFinalMs(timed ? ms : null);
    setShowMethod(true);
    const ok = Object.values(result).every((c) => c.ok);
    setHistory((h) => [{ label: `${exercise.address}/${exercise.prefix}`, prefix: exercise.prefix, ok, ms: timed ? ms : null }, ...h]);
    requestAnimationFrame(() => nextButton.current?.focus());
  };

  const next = () => {
    setSeed(newSeed());
    setCount((c) => c + 1);
    setAnswers(emptyAnswers());
    setChecks(null);
    setShowMethod(false);
    setFinalMs(null);
    setElapsed(0);
    setStartedAt(performance.now());
    requestAnimationFrame(() => firstInput.current?.focus());
  };

  // Statistiques de session.
  const streak = (() => {
    let s = 0;
    for (const h of history) {
      if (!h.ok) break;
      s++;
    }
    return s;
  })();
  const accuracy = history.length ? Math.round((history.filter((h) => h.ok).length / history.length) * 100) : null;
  const timedRuns = history.filter((h) => h.ms !== null);
  const avg = timedRuns.length ? timedRuns.reduce((s, h) => s + (h.ms ?? 0), 0) / timedRuns.length / 1000 : null;
  const missedPrefixes = [...new Set(history.filter((h) => !h.ok).map((h) => h.prefix))].sort((a, b) => a - b);

  const b = octetBreakdown(exercise.answer);
  const fmt1 = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const shownMs = solved ? finalMs : elapsed;

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="min-w-0 flex-[1_1_200px]">
          <div className="font-mono text-[12px] font-medium tracking-[0.6px] text-muted">
            <span className="text-accent">●</span> LABS · IPv4 / CIDR
          </div>
          <h1 className="mt-1 text-[28px] font-semibold">Subnetting trainer</h1>
        </div>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-[13px] text-text2">
          <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} className="h-[18px] w-[18px] accent-accent" />
          Mode chrono
        </label>
      </div>

      <div className="flex flex-wrap gap-5">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
          <section aria-label="Énoncé" className="panel-deep px-5 py-6 sm:px-7">
            <form onSubmit={validate} noValidate>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="label-mono tracking-[1.2px]">Exercice #{count} · trouvez le sous-réseau</span>
                {timed && shownMs !== null && (
                  <span
                    className="font-mono text-[20px] font-semibold tabular"
                    style={{ color: solved ? '#B9C5D8' : shownMs / 1000 > TARGET_SECONDS ? '#F5B544' : '#E7EDF6' }}
                    aria-label={`Temps ${fmt1(shownMs / 1000)} secondes`}
                    role="timer"
                  >
                    {formatStopwatch(shownMs)}
                  </span>
                )}
              </div>
              <div className="mt-3.5 break-all font-mono text-[34px] font-semibold leading-[1.15] tracking-[-1px] sm:text-[44px]">
                {exercise.address}
                <span className="text-accent">/{exercise.prefix}</span>
              </div>

              <div className="mt-[22px] grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))]">
                {SUBNET_FIELDS.map((f, i) => {
                  const c = checks?.[f.id];
                  const border = c ? (c.ok ? '#3DDC97' : '#FF6B5E') : undefined;
                  const id = `sn-${f.id}`;
                  return (
                    <div key={f.id} className="flex flex-col gap-1.5">
                      <label htmlFor={id} className="text-[13px] text-text2">
                        {f.label}
                      </label>
                      <span
                        className="field"
                        style={border ? { borderColor: border, background: c?.ok ? undefined : 'rgba(255,107,94,0.06)' } : undefined}
                      >
                        <input
                          id={id}
                          ref={i === 0 ? firstInput : undefined}
                          type="text"
                          inputMode={f.kind === 'int' ? 'numeric' : 'decimal'}
                          autoComplete="off"
                          spellCheck={false}
                          readOnly={solved}
                          value={answers[f.id]}
                          onChange={(e) => setAnswers((a) => ({ ...a, [f.id]: e.target.value }))}
                          aria-invalid={c ? !c.ok : undefined}
                          aria-describedby={c && !c.ok ? `${id}-hint` : undefined}
                          className="input-bare font-mono text-base font-medium"
                        />
                        {c && (
                          <span className="font-bold" style={{ color: border }}>
                            {c.ok ? '✓' : '✕'}
                            <span className="sr-only">{c.ok ? ' correct' : ' incorrect'}</span>
                          </span>
                        )}
                      </span>
                      {c && !c.ok && c.hint && (
                        <span id={`${id}-hint`} className="font-mono text-[12px] text-crit">
                          {c.hint}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-[22px] flex flex-wrap items-center gap-2.5">
                {!solved ? (
                  <button type="submit" className="btn-primary">
                    Valider · Entrée
                  </button>
                ) : (
                  <button ref={nextButton} type="button" className="btn-primary" onClick={next}>
                    Exercice suivant →
                  </button>
                )}
                <button type="button" className="btn-secondary" aria-expanded={showMethod} aria-controls="methode" onClick={() => setShowMethod((s) => !s)}>
                  {showMethod ? 'Masquer la méthode' : 'Montrer la méthode'}
                </button>
                {solved && (
                  <span aria-live="polite" className={`font-mono text-[13px] font-semibold ${allOk ? 'text-ok' : 'text-crit'}`}>
                    {allOk
                      ? '✓ Tout est juste'
                      : `✕ ${Object.values(checks).filter((c) => !c.ok).length} champ(s) à revoir`}
                  </span>
                )}
              </div>
            </form>
          </section>

          <section aria-labelledby="bin-h" className="panel-deep px-5 py-[22px] sm:px-7">
            <h2 id="bin-h" className="mb-3.5 text-[14px] font-semibold">
              Décomposition binaire · {OCTET_ORDINAL[b.index]} octet
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[460px] border-separate border-spacing-1.5 text-center font-mono text-[15px] font-medium">
                <caption className="sr-only">Bits de l'octet {b.index + 1} de l'adresse et du masque</caption>
                <thead>
                  <tr>
                    <th scope="col" className="w-[120px] text-left text-[12px] font-medium text-muted">
                      poids
                    </th>
                    {[128, 64, 32, 16, 8, 4, 2, 1].map((w) => (
                      <th key={w} scope="col" className="text-[12px] font-medium text-muted">
                        {w}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      [String(b.addressOctet), b.addressBits, false],
                      [`masque /${exercise.prefix}`, b.maskBits, true],
                    ] as const
                  ).map(([label, bits, isMask]) => (
                    <tr key={label}>
                      <th scope="row" className="text-left text-[12px] font-medium text-muted">
                        {label}
                      </th>
                      {bits.map((bit, i) => {
                        const net = b.maskBits[i] === 1;
                        return (
                          <td
                            key={i}
                            className="rounded-md py-2"
                            style={{
                              background: net ? 'rgba(45,212,232,0.14)' : '#162033',
                              color: net ? '#2DD4E8' : isMask ? '#93A1B8' : '#E7EDF6',
                            }}
                          >
                            {bit}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 font-mono text-[11px] text-muted">en cyan : bits de la partie réseau</p>
            {showMethod && (
              <p id="methode" className="mt-3.5 text-text2">
                Pas de bloc = 256 − {b.maskOctet} = <span className="font-mono text-text">{b.blockSize}</span> → sous-réseaux{' '}
                {b.truncated && '… '}
                {b.starts.map((s, i) => (
                  <span key={s}>
                    {i > 0 && ' · '}
                    <span className={`font-mono ${s === b.currentStart ? 'text-accent' : ''}`}>.{s}</span>
                  </span>
                ))}
                {b.truncated && ' …'}. {b.addressOctet} tombe dans le bloc{' '}
                <span className="font-mono text-accent">.{b.currentStart}</span> ; le broadcast est l'adresse juste avant le bloc suivant
                {exercise.prefix < 31 ? (
                  <>
                    , et les hôtes utilisables sont 2<sup>{32 - exercise.prefix}</sup> − 2.
                  </>
                ) : (
                  '.'
                )}
              </p>
            )}
          </section>
        </div>

        <aside className="flex flex-[1_1_280px] flex-col gap-4" aria-label="Session">
          <section aria-labelledby="sess-h" className="panel-deep rounded-xl p-5">
            <h2 id="sess-h" className="mb-3.5 text-[14px] font-semibold">
              Session en cours
            </h2>
            <dl className="m-0 grid grid-cols-2 gap-3">
              <div>
                <dt className="text-[12px] text-muted">Série</dt>
                <dd className="m-0 font-mono text-[24px] font-semibold text-ok">{streak}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Précision</dt>
                <dd className="m-0 font-mono text-[24px] font-semibold">{accuracy === null ? '—' : `${accuracy} %`}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Temps moyen</dt>
                <dd className="m-0 font-mono text-[24px] font-semibold">{avg === null ? '—' : `${fmt1(avg)} s`}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Objectif</dt>
                <dd className="m-0 font-mono text-[24px] font-semibold text-muted">&lt; {TARGET_SECONDS} s</dd>
              </div>
            </dl>
          </section>
          <section aria-labelledby="last-h" className="panel-deep rounded-xl p-5">
            <h2 id="last-h" className="mb-3 text-[14px] font-semibold">
              Derniers exercices
            </h2>
            {history.length === 0 ? (
              <p className="m-0 text-[13px] text-muted">Validez un premier exercice pour démarrer la série.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col p-0 font-mono text-[13px]">
                {history.slice(0, 8).map((h, i) => (
                  <li key={i} className="flex justify-between gap-2 border-b border-[#1A2539] py-1.5 last:border-b-0">
                    <span>{h.label}</span>
                    <span className={h.ok ? 'text-ok' : 'text-crit'}>
                      {h.ok ? '✓' : '✕'}
                      {h.ms !== null ? ` ${fmt1(h.ms / 1000)} s` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {missedPrefixes.length > 0 && (
            <section className="rounded-xl border border-dashed border-line2 px-5 py-4 text-[13px] text-text2">
              Préfixes ratés cette session :{' '}
              <span className="font-mono text-text">{missedPrefixes.map((p) => `/${p}`).join(' · ')}</span>.
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
