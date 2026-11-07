import type { ReactNode } from 'react';
import { errorMessage } from '../lib/api';
import { MASTERY_HEX, masteryOf, type Mastery } from '../lib/format';
import { IconAlert } from './Icons';

export function Led({ color = '#3DDC97', size = 8 }: { color?: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="led inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: color }}
    />
  );
}

export function Spinner({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-10 font-mono text-[12px] text-muted">
      <Led color="#2DD4E8" />
      {label}
    </div>
  );
}

export function ErrorBox({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-start gap-3 rounded-[10px] border px-4 py-3 text-[13.5px]"
      style={{ borderColor: 'rgba(255,107,94,.45)', background: 'rgba(255,107,94,.07)' }}
    >
      <IconAlert className="mt-0.5 text-crit" />
      <div className="min-w-0 flex-1">
        {title && <div className="font-medium text-text">{title}</div>}
        <div className="text-text2">{errorMessage(error)}</div>
      </div>
      {onRetry && (
        <button type="button" className="btn-secondary btn-sm" onClick={onRetry}>
          Réessayer
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-[10px] border border-dashed border-line2 px-5 py-5">
      <div className="font-medium text-text">{title}</div>
      {children && <div className="max-w-prose text-[13px] text-text2">{children}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

const MASTERY_SYMBOL: Record<Mastery, string> = { ok: '✓', warn: '▲', crit: '✕' };

/** Valeur en % colorée selon le seuil, doublée d'un symbole (jamais la couleur seule). */
export function MasteryValue({ percent, className = '' }: { percent: number | null; className?: string }) {
  if (percent === null) return <span className={`font-mono text-muted ${className}`}>—</span>;
  const m = masteryOf(percent);
  return (
    <span className={`font-mono font-semibold tabular ${className}`} style={{ color: m === 'crit' ? MASTERY_HEX.crit : undefined }}>
      <span aria-hidden style={{ color: MASTERY_HEX[m] }} className="mr-1 text-[10px]">
        {MASTERY_SYMBOL[m]}
      </span>
      {Math.round(percent)} %
    </span>
  );
}

export function MasteryBar({ percent, marker }: { percent: number | null; marker?: number }) {
  const color = percent === null ? '#2B3B57' : MASTERY_HEX[masteryOf(percent)];
  return (
    <span className="relative block h-1.5 rounded-[3px] bg-raised" aria-hidden>
      <span
        className="block h-full rounded-[3px] transition-[width] duration-700"
        style={{ width: `${percent ?? 0}%`, background: color, boxShadow: percent ? `0 0 10px ${color}` : 'none' }}
      />
      {marker !== undefined && (
        <span className="absolute -top-[3px] h-3 w-0.5 bg-text opacity-50" style={{ left: `${marker}%` }} />
      )}
    </span>
  );
}

export function PageTitle({ eyebrow, title, children }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="min-w-0 flex-[1_1_320px]">
        {eyebrow && <div className="font-mono text-[12px] font-medium tracking-[0.6px] text-muted">{eyebrow}</div>}
        <h1 className="mt-1.5 text-[28px] font-semibold leading-tight sm:text-[34px]">{title}</h1>
      </div>
      {children}
    </div>
  );
}
