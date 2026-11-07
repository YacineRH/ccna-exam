import { describe, expect, it } from 'vitest';
import type { PoolQuestion } from '../src/assembly.js';
import { parseCertification, type Difficulty } from '../src/certification.js';
import { createRng, shuffle } from '../src/random.js';
import {
  assembleSeries,
  checkBankForSeries,
  checkSeries,
  InsufficientBankError,
  SeriesConstraintError,
  seriesReport,
  type SeriesOptions,
} from '../src/series.js';

/** Certification de démonstration : 20 questions par examen, trois domaines à sous-thèmes. */
const cert = parseCertification({
  code: 'demo',
  name: 'Démo',
  vendor: 'Test',
  examCode: 'D-1',
  domains: [
    { code: 'A', name: 'Alpha', weight: 0.5, subtopics: [{ code: 'A1', name: 'a1' }, { code: 'A2', name: 'a2' }, { code: 'A3', name: 'a3' }] },
    { code: 'B', name: 'Bravo', weight: 0.3, subtopics: [{ code: 'B1', name: 'b1' }, { code: 'B2', name: 'b2' }] },
    { code: 'C', name: 'Charlie', weight: 0.2, subtopics: [{ code: 'C1', name: 'c1' }, { code: 'C2', name: 'c2' }] },
  ],
  scoring: { min: 300, max: 1000, passing: 700 },
  examFormat: { questionCount: 20, durationMinutes: 30, allowBackNavigation: false },
  allowedQuestionTypes: ['mcq_single', 'mcq_multi', 'fill_blank'],
});

const DIFF: Difficulty[] = ['easy', 'easy', 'easy', 'medium', 'medium', 'medium', 'medium', 'medium', 'hard', 'hard'];

/** Banque proportionnelle aux places de la série : `perDomain` questions par domaine, 30/50/20 en difficulté. */
function bank(perDomain: Record<string, number>): PoolQuestion[] {
  const out: PoolQuestion[] = [];
  for (const d of cert.domains) {
    const n = perDomain[d.code] ?? 0;
    for (let i = 0; i < n; i++) {
      out.push({
        id: `${d.code}-${String(i).padStart(3, '0')}`,
        domain: d.code,
        subtopic: d.subtopics[i % d.subtopics.length]?.code ?? null,
        type: (['mcq_single', 'mcq_multi', 'fill_blank'] as const)[i % 3] as PoolQuestion['type'],
        difficulty: DIFF[i % DIFF.length] as Difficulty,
      });
    }
  }
  return out;
}

// 30 examens de 20 questions : 10 / 6 / 4 par domaine, soit 300 / 180 / 120 places.
const OPTIONS: SeriesOptions = { seed: 7, examCount: 30, maxUses: 6, maxOverlap: 6 };
const POOL = bank({ A: 60, B: 36, C: 24 });

describe('assembleSeries', () => {
  const { exams, report } = assembleSeries(POOL, cert, OPTIONS);
  const domainOf = new Map(POOL.map((q) => [q.id, q.domain]));

  it('produit le nombre d’examens demandé, au format officiel, sans doublon', () => {
    expect(exams).toHaveLength(30);
    for (const exam of exams) {
      expect(exam).toHaveLength(20);
      expect(new Set(exam).size).toBe(20);
      const byDomain = { A: 0, B: 0, C: 0 } as Record<string, number>;
      for (const id of exam) byDomain[domainOf.get(id) as string]!++;
      expect(byDomain).toEqual({ A: 10, B: 6, C: 4 });
    }
  });

  it('tient les plafonds de réutilisation et de recouvrement, et sert chaque question', () => {
    const uses = new Map<string, number>();
    for (const exam of exams) for (const id of exam) uses.set(id, (uses.get(id) ?? 0) + 1);
    expect(uses.size).toBe(POOL.length);
    expect(Math.max(...uses.values())).toBeLessThanOrEqual(OPTIONS.maxUses);
    for (let a = 0; a < exams.length; a++) {
      for (let b = a + 1; b < exams.length; b++) {
        const common = exams[a]!.filter((id) => exams[b]!.includes(id)).length;
        expect(common, `examens ${a + 1} et ${b + 1}`).toBeLessThanOrEqual(OPTIONS.maxOverlap);
      }
    }
    expect(checkSeries(exams, POOL, cert, OPTIONS)).toEqual([]);
  });

  it('équilibre les difficultés et les sous-thèmes dans chaque examen', () => {
    // 20 questions à 30/50/20 : 6 faciles, 10 moyennes, 4 difficiles, à deux près.
    for (const r of report.exams) {
      expect(Math.abs(r.byDifficulty.easy - 6), `examen ${r.number}`).toBeLessThanOrEqual(2);
      expect(Math.abs(r.byDifficulty.medium - 10), `examen ${r.number}`).toBeLessThanOrEqual(2);
      expect(Math.abs(r.byDifficulty.hard - 4), `examen ${r.number}`).toBeLessThanOrEqual(2);
      expect(r.subtopicsCovered, `examen ${r.number}`).toBe(7);
    }
  });

  it('rejoue la même série avec le même seed, quel que soit l’ordre de la banque', () => {
    const again = assembleSeries(POOL, cert, OPTIONS);
    expect(again.exams).toEqual(exams);
    const reordered = assembleSeries(shuffle(createRng(99), POOL), cert, OPTIONS);
    expect(reordered.exams).toEqual(exams);
    const other = assembleSeries(POOL, cert, { ...OPTIONS, seed: 8 });
    expect(other.exams).not.toEqual(exams);
  });

  it('dit quel domaine manque de questions, et combien', () => {
    // C : 4 places × 30 examens / 6 utilisations au plus = 20 questions nécessaires.
    const thin = bank({ A: 60, B: 36, C: 15 });
    expect(() => assembleSeries(thin, cert, OPTIONS)).toThrow(InsufficientBankError);
    try {
      checkBankForSeries(thin, cert, OPTIONS);
    } catch (err) {
      const e = err as InsufficientBankError;
      expect(e.domain).toBe('C');
      expect(e.needed).toBe(20);
      expect(e.available).toBe(15);
      expect(e.missing).toBe(5);
      expect(e.message).toContain('il en manque 5');
    }
  });

  it('refuse une banque dont des questions ne serviraient jamais', () => {
    // B : 6 places × 30 examens = 180 places pour 200 questions.
    expect(() => assembleSeries(bank({ A: 60, B: 200, C: 24 }), cert, OPTIONS)).toThrow(SeriesConstraintError);
  });

  it('signale un plafond de recouvrement intenable', () => {
    // Avec 60 questions pour 10 places en A, deux examens partagent forcément des questions : 0 est intenable.
    expect(() => assembleSeries(POOL, cert, { ...OPTIONS, maxOverlap: 0 })).toThrow(SeriesConstraintError);
  });

  it('ignore les types non autorisés par la certification', () => {
    const withCli = [...POOL, { id: 'A-cli', domain: 'A', subtopic: 'A1', type: 'cli' as const, difficulty: 'easy' as const }];
    const result = assembleSeries(withCli, cert, OPTIONS);
    expect(result.exams.flat()).not.toContain('A-cli');
  });
});

describe('seriesReport', () => {
  const pool: PoolQuestion[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({
    id,
    domain: 'A',
    subtopic: i < 3 ? 'A1' : 'A2',
    type: 'mcq_single',
    difficulty: i % 2 ? 'hard' : 'easy',
  }));
  const exams = [
    ['a', 'b', 'c'],
    ['a', 'b', 'd'],
    ['d', 'e', 'a'],
  ];
  const report = seriesReport(exams, pool, cert);

  it('compte la réutilisation de chaque question', () => {
    expect(report.uses).toEqual({ min: 0, max: 3, mean: 1.5, histogram: { 0: 1, 1: 2, 2: 2, 3: 1 }, unused: ['f'] });
  });

  it('mesure les recouvrements : maximum, moyenne et paire la plus proche', () => {
    // (1,2) : a, b ; (1,3) : a ; (2,3) : a, d.
    expect(report.overlap.max).toBe(2);
    expect(report.overlap.mean).toBe(1.67);
    expect(report.overlap.maxPair).toEqual([1, 2]);
    expect(report.overlap.histogram).toEqual({ 1: 1, 2: 2 });
  });

  it('décrit chaque examen : domaines, difficultés, sous-thèmes couverts', () => {
    expect(report.exams[0]).toMatchObject({ number: 1, byDomain: { A: 3 }, byDifficulty: { easy: 2, medium: 0, hard: 1 }, subtopicsCovered: 1 });
    expect(report.exams[2]).toMatchObject({ number: 3, byDifficulty: { easy: 2, medium: 0, hard: 1 }, subtopicsCovered: 2 });
    expect(report.subtopics).toEqual({ total: 7, minCovered: 1, meanCovered: 1.67 });
  });
});

describe('checkSeries', () => {
  const { exams } = assembleSeries(POOL, cert, OPTIONS);

  it('relève un doublon, une répartition faussée, une question inconnue', () => {
    const broken = exams.map((e) => [...e]);
    broken[0]![1] = broken[0]![0] as string;
    broken[1]![0] = 'inconnue';
    const issues = checkSeries(broken, POOL, cert, OPTIONS);
    expect(issues.some((i) => i.startsWith('examen 1 : question en double'))).toBe(true);
    expect(issues.some((i) => i.startsWith('examen 2 : questions inconnues inconnue'))).toBe(true);
    expect(issues.some((i) => /examen 2 : \d+ questions du domaine/.test(i))).toBe(true);
  });

  it('relève les plafonds dépassés et les questions jamais servies', () => {
    const copies = [exams[0]!, ...exams.slice(1).map(() => exams[0]!)];
    const issues = checkSeries(copies, POOL, cert, OPTIONS);
    expect(issues).toContain(`${POOL.length - 20} questions publiées ne servent dans aucun examen`);
    expect(issues).toContain('une question sert dans 30 examens (plafond 6)');
    expect(issues).toContain('les examens 1 et 2 ont 20 questions communes (plafond 6)');
  });
});
