import { describe, expect, it } from 'vitest';
import { examMinutes, maxFeasibleCount, planShortfalls } from './planning';

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

describe('examMinutes', () => {
  it('proportionnel au format officiel', () => {
    expect(examMinutes(102, { questionCount: 102, durationMinutes: 120 })).toBe(120);
    expect(examMinutes(10, { questionCount: 102, durationMinutes: 120 })).toBe(12);
    expect(examMinutes(0, { questionCount: 102, durationMinutes: 120 })).toBe(1);
  });
});
