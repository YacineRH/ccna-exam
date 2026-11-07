/** Outils sans état de la révision espacée côté navigateur (l'algorithme est dans packages/core). */

export const LEITNER_BOXES = 7;

/** « aujourd'hui », « demain », « dans 3 jours » : distance en jours calendaires locaux. */
export function dueLabel(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '—';
  const day = (d: Date) => Math.floor((d.getTime() - d.getTimezoneOffset() * 60_000) / 86_400_000);
  const diff = day(new Date(iso)) - day(now);
  if (diff <= 0) return 'aujourd’hui';
  if (diff === 1) return 'demain';
  return `dans ${diff} jours`;
}
