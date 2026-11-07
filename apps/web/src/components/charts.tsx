import { useState } from 'react';
import { gaugeDash, gaugeMarker, lineChart, radarPoint, radarPolygon, yFor } from '../lib/charts';
import { formatPercent, MASTERY_HEX, masteryOf, shortDomain } from '../lib/format';

/** Jauge circulaire de préparation (maquette Main) : arc animé + repère du seuil. */
export function ReadinessGauge({ estimate, passing, max }: { estimate: number | null; passing: number; max: number }) {
  const r = 84;
  const { dash, circumference } = gaugeDash(estimate === null ? 0 : estimate / max, r);
  const marker = gaugeMarker(passing / max, 100, 100, r);
  const label =
    estimate === null
      ? `Préparation non estimée, seuil ${passing} sur ${max}`
      : `Préparation ${estimate} sur ${max}, seuil ${passing}`;
  return (
    <div className="relative h-[200px] w-[200px] shrink-0">
      <svg viewBox="0 0 200 200" width="200" height="200" role="img" aria-label={label}>
        <circle cx="100" cy="100" r={r} fill="none" stroke="#162033" strokeWidth="12" />
        <circle cx="100" cy="100" r={r} fill="none" stroke="#1E2B42" strokeWidth="1" strokeDasharray="2 6" transform="rotate(-90 100 100)" />
        {estimate !== null && (
          <circle
            className="ring-anim glow"
            cx="100"
            cy="100"
            r={r}
            fill="none"
            stroke="#2DD4E8"
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            transform="rotate(-90 100 100)"
          />
        )}
        <circle cx={marker.x} cy={marker.y} r="7" fill="#080C15" stroke="#3DDC97" strokeWidth="3" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-[46px] font-semibold leading-none tracking-[-2px]">{estimate ?? '—'}</span>
        <span className="mt-1 font-mono text-[12px] font-medium text-muted">/ {max}</span>
      </div>
    </div>
  );
}

export function Sparkline({ values, min, max }: { values: number[]; min: number; max: number }) {
  if (values.length < 2) return null;
  const { line } = lineChart(values, { width: 96, height: 32, min, max, padX: 2, padY: 3 });
  return (
    <svg width="96" height="32" viewBox="0 0 96 32" aria-hidden className="shrink-0">
      <path d={line} fill="none" stroke="#2DD4E8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="glow" />
    </svg>
  );
}

export interface RadarDatum {
  code: string;
  name: string;
  percent: number | null;
}

/** Radar de maîtrise par domaine, polygone du seuil en pointillés verts. */
export function RadarChart({ data, threshold }: { data: RadarDatum[]; threshold: number }) {
  const cx = 150;
  const cy = 150;
  const R = 110;
  const n = data.length;
  if (n < 3) return null;
  const rings = [1, 0.5, 0.25].map((f) => radarPolygon(Array(n).fill(f), cx, cy, R));
  const axes = data.map((_, i) => radarPoint(i, n, 1, cx, cy, R));
  const values = data.map((d) => (d.percent ?? 0) / 100);
  const label = data
    .map((d) => `${d.name} ${d.percent === null ? 'sans donnée' : formatPercent(d.percent)}`)
    .join(', ');
  return (
    <svg viewBox="-10 0 320 300" width="320" height="300" role="img" aria-label={`Radar : ${label}`} className="max-w-full shrink-0">
      <g fill="none" stroke="#1E2B42" strokeWidth="1">
        {rings.map((p, i) => (
          <polygon key={i} points={p} />
        ))}
        {axes.map((p, i) => (
          <path key={i} d={`M${cx} ${cy}L${p.x} ${p.y}`} />
        ))}
      </g>
      <polygon
        points={radarPolygon(Array(n).fill(threshold / 100), cx, cy, R)}
        fill="none"
        stroke="#3DDC97"
        strokeWidth="1.2"
        strokeDasharray="4 4"
      />
      <polygon className="glow" points={radarPolygon(values, cx, cy, R)} fill="rgba(45,212,232,0.18)" stroke="#2DD4E8" strokeWidth="2" strokeLinejoin="round" />
      <g fill="#080C15" strokeWidth="2">
        {data.map((d, i) => {
          const p = radarPoint(i, n, values[i] ?? 0, cx, cy, R);
          const crit = d.percent !== null && masteryOf(d.percent) === 'crit';
          return <circle key={d.code} cx={p.x} cy={p.y} r="4" stroke={crit ? '#FF6B5E' : '#2DD4E8'} />;
        })}
      </g>
      <g fontFamily="IBM Plex Mono, monospace" fontSize="11" fill="#93A1B8" textAnchor="middle">
        {data.map((d, i) => {
          const p = radarPoint(i, n, 1.2, cx, cy, R);
          const crit = d.percent !== null && masteryOf(d.percent) === 'crit';
          return (
            <text key={d.code} x={p.x} y={p.y + 4} fill={crit ? '#FF6B5E' : '#93A1B8'}>
              {shortDomain(d.code, d.name)} {d.percent === null ? '—' : Math.round(d.percent)}
            </text>
          );
        })}
      </g>
    </svg>
  );
}

export interface ScorePoint {
  attemptId: string;
  scaledScore: number;
  submittedAt: string;
}

/** Courbe de progression des examens blancs, avec la ligne du seuil. */
export function ProgressChart({ scores, passing, min, max }: { scores: ScorePoint[]; passing: number; min: number; max: number }) {
  const [range, setRange] = useState<'12' | 'all'>('12');
  const shown = range === '12' ? scores.slice(-12) : scores;
  const W = 600;
  const H = 220;
  const chart = lineChart(
    shown.map((s) => s.scaledScore),
    { width: W, height: H, min, max, padX: 20, padY: 10 },
  );
  const thresholdY = yFor(passing, { height: H, min, max });
  const firstIndex = scores.length - shown.length + 1;
  const last = shown[shown.length - 1];
  const first = shown[0];
  const lastPoint = chart.points[chart.points.length - 1];
  const label = first && last
    ? `Score passé de ${first.scaledScore} à ${last.scaledScore} sur ${shown.length} examens, seuil ${passing}`
    : 'Aucun examen';

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h2 id="prog-h" className="text-base font-semibold">
          Progression
        </h2>
        {scores.length > 12 && (
          <div role="group" aria-label="Période" className="flex gap-0.5 rounded-lg border border-line bg-well p-[3px] font-mono text-[12px] font-medium">
            {(['12', 'all'] as const).map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={range === r}
                onClick={() => setRange(r)}
                className={`h-8 rounded-md px-2.5 ${range === r ? 'bg-[#1C2A40] text-text' : 'text-muted'}`}
              >
                {r === '12' ? '12 ex.' : 'Tout'}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="relative mt-4">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="250" preserveAspectRatio="none" role="img" aria-label={label}>
          <g stroke="#162033" strokeWidth="1">
            <path d={`M0 10H${W}M0 55H${W}M0 100H${W}M0 145H${W}M0 190H${W}`} vectorEffect="non-scaling-stroke" />
          </g>
          <path d={`M0 ${thresholdY}H${W}`} stroke="#3DDC97" strokeWidth="1.2" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
          {chart.points.length > 1 && <path d={chart.area} fill="rgba(45,212,232,0.10)" />}
          {chart.points.length > 1 && (
            <path className="glow" d={chart.line} fill="none" stroke="#2DD4E8" strokeWidth="2.4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        {/* Points en HTML pour rester ronds malgré preserveAspectRatio="none". */}
        {chart.points.map((p, i) => (
          <span
            key={shown[i]?.attemptId ?? i}
            aria-hidden
            className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-bg"
            style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 250}px` }}
          />
        ))}
        {last && lastPoint && (
          <div
            className="absolute right-0 rounded-lg border bg-well px-2.5 py-1.5 font-mono text-[12px] font-medium"
            style={{ top: Math.max(0, (lastPoint.y / H) * 250 - 44), borderColor: 'rgba(45,212,232,.45)', boxShadow: '0 8px 20px -8px rgba(0,0,0,.8)' }}
          >
            #{scores.length} · <span className="text-accent">{last.scaledScore}</span>
          </div>
        )}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[11px] font-medium text-muted">
        <span>{first ? `#${firstIndex} · ${first.scaledScore}` : ''}</span>
        <span className="text-ok">- - seuil {passing}</span>
        <span>{last ? `#${scores.length}` : ''}</span>
      </div>
    </>
  );
}

export function MasteryLegend() {
  return (
    <div className="flex flex-col gap-2.5 text-[13px] text-text2">
      {(
        [
          ['ok', 'Maîtrisé ≥ 80 %'],
          ['warn', 'À consolider 60–79 %'],
          ['crit', 'Critique < 60 %'],
        ] as const
      ).map(([k, l]) => (
        <div key={k} className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: MASTERY_HEX[k] }} />
          {l}
        </div>
      ))}
    </div>
  );
}
