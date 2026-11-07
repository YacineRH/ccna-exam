import { allocateByWeight } from '@examforge/core';

export interface Shortfall {
  domain: string;
  needed: number;
  available: number;
}

type WeightedDomain = { code: string; weight: number };

/**
 * Reproduit la répartition du serveur (pondération officielle, plus fort reste)
 * pour prévenir avant l'envoi qu'un domaine manque de questions.
 */
export function planShortfalls(domains: readonly WeightedDomain[], bank: Record<string, number>, count: number): Shortfall[] {
  if (domains.length === 0 || count < 1) return [];
  const plan = allocateByWeight(domains, count);
  const out: Shortfall[] = [];
  for (const d of domains) {
    const needed = plan.get(d.code) ?? 0;
    const available = bank[d.code] ?? 0;
    if (needed > available) out.push({ domain: d.code, needed, available });
  }
  return out;
}

/** Plus grand nombre de questions tirable avec ces domaines (0 si aucun). */
export function maxFeasibleCount(domains: readonly WeightedDomain[], bank: Record<string, number>, upper: number): number {
  if (domains.length === 0) return 0;
  for (let n = upper; n >= 1; n--) if (planShortfalls(domains, bank, n).length === 0) return n;
  return 0;
}

/** Durée accordée par le serveur : proportionnelle au format officiel, au moins 1 min. */
export function examMinutes(count: number, format: { questionCount: number; durationMinutes: number }): number {
  return Math.max(1, Math.round((format.durationMinutes * count) / format.questionCount));
}
