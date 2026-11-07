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

export interface BankCounts {
  byDomain: Record<string, number>;
  byDomainType: Record<string, Record<string, number>>;
}

/**
 * Questions disponibles par domaine pour les types retenus. Sans filtre (`types` nul),
 * c'est simplement le décompte par domaine.
 */
export function countsForTypes(bank: BankCounts, types: readonly string[] | null): Record<string, number> {
  if (!types) return bank.byDomain;
  return Object.fromEntries(
    Object.keys(bank.byDomain).map((d) => [d, types.reduce((s, t) => s + (bank.byDomainType[d]?.[t] ?? 0), 0)]),
  );
}

/**
 * Domaines réellement tirés, comme le fait le serveur : avec un filtre de types, les domaines sans
 * question de ces types sont écartés et les pondérations des autres renormalisées.
 */
export function domainsForTypes<D extends WeightedDomain>(domains: readonly D[], counts: Record<string, number>, filtered: boolean): D[] {
  return filtered ? domains.filter((d) => (counts[d.code] ?? 0) > 0) : [...domains];
}

/** Plus grand nombre de questions tirable avec ces domaines et ces types (0 si aucun). */
export function maxFeasibleWithTypes(
  domains: readonly WeightedDomain[],
  bank: BankCounts,
  types: readonly string[] | null,
  upper: number,
): number {
  const counts = countsForTypes(bank, types);
  return maxFeasibleCount(domainsForTypes(domains, counts, types !== null), counts, upper);
}

/** Durée accordée par le serveur : proportionnelle au format officiel, au moins 1 min. */
export function examMinutes(count: number, format: { questionCount: number; durationMinutes: number }): number {
  return Math.max(1, Math.round((format.durationMinutes * count) / format.questionCount));
}
