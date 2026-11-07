/** Formats d'affichage (français) : chrono, durées, dates, nombres, niveaux de maîtrise. */

const pad = (n: number) => String(n).padStart(2, '0');

/** Chrono d'examen : "01:26:47" (heures toujours affichées, comme sur la maquette). */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${pad(h)}:${pad(m)}:${pad(s % 60)}`;
}

/** Chrono court avec dixièmes : "00:14.6". */
export function formatStopwatch(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 100));
  const tenths = t % 10;
  const s = Math.floor(t / 10);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}.${tenths}`;
}

/** Durée lisible : "42 s", "1 min 54", "1 h 46 min". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return s % 60 ? `${m} min ${pad(s % 60)}` : `${m} min`;
  return m ? `${h} h ${pad(m)} min` : `${h} h`;
}

/** Durée totale façon horloge : "1:46:12" ou "4:05". */
export function formatHms(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

const nf = new Intl.NumberFormat('fr-FR');
export function formatNumber(n: number): string {
  return nf.format(n);
}

/** Pourcentage français avec au plus une décimale : "82,5 %". */
export function formatPercent(p: number, digits = 0): string {
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(p)} %`;
}

export function formatDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string | Date): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** En-tête du tableau de bord : "MAR. 13 OCT. 2026". */
export function formatDayHeader(d: Date): string {
  return d
    .toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    .toUpperCase();
}

export type Mastery = 'ok' | 'warn' | 'crit';

/** Seuils du design system : maîtrisé ≥ 80 %, à consolider 60–79 %, critique < 60 %. */
export function masteryOf(percent: number): Mastery {
  if (percent >= 80) return 'ok';
  if (percent >= 60) return 'warn';
  return 'crit';
}

export const MASTERY_LABEL: Record<Mastery, string> = {
  ok: 'Maîtrisé',
  warn: 'À consolider',
  crit: 'Critique',
};

export const MASTERY_HEX: Record<Mastery, string> = {
  ok: '#3DDC97',
  warn: '#F5B544',
  crit: '#FF6B5E',
};

/** Initiales pour l'avatar : "Yacine R." -> "YR". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : (parts[0]?.[1] ?? '');
  return (first + last).toUpperCase();
}

export function greeting(d: Date): string {
  const h = d.getHours();
  return h >= 18 || h < 5 ? 'Bonsoir' : 'Bonjour';
}

/** Lettre d'option : 0 -> "A". */
export function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** Domaine court pour les graphiques : "Network Fundamentals" -> "FUND". */
export function shortDomain(code: string, name: string): string {
  const map: Record<string, string> = {
    'Network Fundamentals': 'FUND',
    'Network Access': 'ACCESS',
    'IP Connectivity': 'IP CONN',
    'IP Services': 'IP SVC',
    'Security Fundamentals': 'SEC',
    'Automation and Programmability': 'AUTO',
  };
  return map[name] ?? (name.split(/\s+/)[0]?.slice(0, 6).toUpperCase() || code);
}
