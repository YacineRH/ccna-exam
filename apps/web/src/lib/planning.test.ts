import { describe, expect, it } from 'vitest';
import { countsForTypes, domainsForTypes, examMinutes, maxFeasibleCount, maxFeasibleWithTypes, planShortfalls } from './planning';

const domains = [
  { code: '1.0', weight: 0.2 },
  { code: '2.0', weight: 0.2 },
  { code: '3.0', weight: 0.25 },
  { code: '4.0', weight: 0.1 },
  { code: '5.0', weight: 0.15 },
  { code: '6.0', weight: 0.1 },
];
const bank = { '1.0': 4, '2.0': 3, '3.0': 3, '4.0': 2, '5.0': 3, '6.0': 2 };

describe('planShortfalls', () => {
  it('signale les domaines trop pauvres', () => {
    const s = planShortfalls(domains, bank, 102);
    expect(s.find((x) => x.domain === '3.0')).toEqual({ domain: '3.0', needed: 26, available: 3 });
  });
  it('rien à signaler quand la banque suffit', () => {
    expect(planShortfalls(domains, bank, 10)).toEqual([]);
  });
});

describe('maxFeasibleCount', () => {
  it('trouve le plus grand tirage possible', () => {
    const n = maxFeasibleCount(domains, bank, 102);
    expect(n).toBeGreaterThan(0);
    expect(planShortfalls(domains, bank, n)).toEqual([]);
    expect(planShortfalls(domains, bank, n + 1).length).toBeGreaterThan(0);
  });
  it('0 sans domaine', () => {
    expect(maxFeasibleCount([], bank, 10)).toBe(0);
  });
});

describe('faisabilité avec un filtre de types', () => {
  // 1.0 : 3 QCM + 1 ordre ; 2.0 : 3 QCM ; 3.0 : 2 QCM + 1 CLI ; les autres : QCM seulement.
  const typed = {
    byDomain: bank,
    byDomainType: {
      '1.0': { mcq_single: 3, ordering: 1 },
      '2.0': { mcq_single: 3 },
      '3.0': { mcq_single: 2, cli: 1 },
      '4.0': { mcq_single: 2 },
      '5.0': { mcq_single: 3 },
      '6.0': { mcq_single: 2 },
    },
  };

  it('compte les questions des types retenus par domaine', () => {
    expect(countsForTypes(typed, null)).toBe(bank);
    expect(countsForTypes(typed, ['ordering', 'cli'])).toEqual({ '1.0': 1, '2.0': 0, '3.0': 1, '4.0': 0, '5.0': 0, '6.0': 0 });
  });

  it('écarte les domaines sans question des types retenus, comme le serveur', () => {
    const counts = countsForTypes(typed, ['ordering', 'cli']);
    expect(domainsForTypes(domains, counts, true).map((d) => d.code)).toEqual(['1.0', '3.0']);
    expect(domainsForTypes(domains, counts, false)).toHaveLength(6);
  });

  it('donne le maximum tirable en tenant compte des types', () => {
    // Une question « ordre » (1.0) et une CLI (3.0) : poids renormalisés 0,2/0,45 et 0,25/0,45, donc 2 au plus.
    expect(maxFeasibleWithTypes(domains, typed, ['ordering', 'cli'], 102)).toBe(2);
    expect(maxFeasibleWithTypes(domains, typed, ['ordering'], 102)).toBe(1);
    expect(maxFeasibleWithTypes(domains, typed, ['matching'], 102)).toBe(0);
    // Sans filtre, on retrouve le calcul par domaine.
    expect(maxFeasibleWithTypes(domains, typed, null, 102)).toBe(maxFeasibleCount(domains, bank, 102));
  });
});

describe('examMinutes', () => {
  it('proportionnel au format officiel', () => {
    expect(examMinutes(102, { questionCount: 102, durationMinutes: 120 })).toBe(120);
    expect(examMinutes(10, { questionCount: 102, durationMinutes: 120 })).toBe(12);
    expect(examMinutes(0, { questionCount: 102, durationMinutes: 120 })).toBe(1);
  });
});
