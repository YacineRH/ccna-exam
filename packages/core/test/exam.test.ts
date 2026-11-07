import { describe, expect, it } from 'vitest';
import { allocateByWeight, assembleExam, InsufficientQuestionsError, type PoolQuestion } from '../src/assembly.js';
import { parseCertification } from '../src/certification.js';
import { estimateReadiness, scoreExam } from '../src/scoring.js';

const cert = parseCertification({
  code: 'demo',
  name: 'Démo',
  vendor: 'Test',
  examCode: 'D-1',
  domains: [
    { code: 'A', name: 'Alpha', weight: 0.5 },
    { code: 'B', name: 'Bravo', weight: 0.3 },
    { code: 'C', name: 'Charlie', weight: 0.2 },
  ],
  scoring: { min: 300, max: 1000, passing: 825 },
  examFormat: { questionCount: 10, durationMinutes: 20, allowBackNavigation: false },
  allowedQuestionTypes: ['mcq_single', 'mcq_multi'],
});

function pool(perDomain: number): PoolQuestion[] {
  return ['A', 'B', 'C'].flatMap((domain) =>
    Array.from({ length: perDomain }, (_, i) => ({
      id: `${domain}-${i}`,
      domain,
      type: 'mcq_single' as const,
      difficulty: 'medium' as const,
    })),
  );
}

describe('certification', () => {
  it('refuse des pondérations qui ne font pas 100 %', () => {
    expect(() =>
      parseCertification({ ...cert, domains: [{ code: 'A', name: 'A', weight: 0.6 }] }),
    ).toThrow(/pondérations/);
  });
});

describe('assembleExam', () => {
  it('répartit selon les poids, au total exact', () => {
    const plan = allocateByWeight(
      [
        { code: '1.0', weight: 0.2 },
        { code: '2.0', weight: 0.2 },
        { code: '3.0', weight: 0.25 },
        { code: '4.0', weight: 0.1 },
        { code: '5.0', weight: 0.15 },
        { code: '6.0', weight: 0.1 },
      ],
      102,
    );
    expect([...plan.values()].reduce((s, n) => s + n, 0)).toBe(102);
    expect(plan.get('3.0')).toBe(26);
  });

  it('ne met jamais deux fois la même question et respecte la pondération', () => {
    const ids = assembleExam(pool(20), cert, { seed: 7 });
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
    expect(ids.filter((id) => id.startsWith('A')).length).toBe(5);
    expect(ids.filter((id) => id.startsWith('C')).length).toBe(2);
  });

  it('est reproductible avec le même seed et varie avec un autre', () => {
    expect(assembleExam(pool(20), cert, { seed: 1 })).toEqual(assembleExam(pool(20), cert, { seed: 1 }));
    expect(assembleExam(pool(20), cert, { seed: 1 })).not.toEqual(assembleExam(pool(20), cert, { seed: 2 }));
  });

  it('privilégie les questions jamais vues', () => {
    const first = assembleExam(pool(10), cert, { seed: 3 });
    const second = assembleExam(pool(10), cert, { seed: 4, avoidIds: first });
    expect(second.filter((id) => first.includes(id))).toEqual([]);
  });

  it('exclut les types non autorisés et signale une banque trop petite', () => {
    const p = pool(20).map((q) => (q.domain === 'C' ? { ...q, type: 'cli' as const } : q));
    expect(() => assembleExam(p, cert, { seed: 1 })).toThrow(InsufficientQuestionsError);
  });
});

describe('scoreExam', () => {
  it('note par domaine et pondère selon les poids officiels', () => {
    const items = [
      ...Array.from({ length: 5 }, () => ({ domain: 'A', correct: true, seconds: 30 })),
      ...Array.from({ length: 3 }, (_, i) => ({ domain: 'B', correct: i > 0, seconds: 60 })),
      ...Array.from({ length: 2 }, () => ({ domain: 'C', correct: false, seconds: 90 })),
    ];
    const s = scoreExam(items, cert);
    expect(s.correct).toBe(7);
    // 0.5 * 1 + 0.3 * 2/3 + 0.2 * 0 = 0.7 -> 300 + 700 * 0.7 = 790
    expect(s.scaled).toBe(790);
    expect(s.passed).toBe(false);
    expect(s.margin).toBe(-35);
    expect(s.weakestDomain).toBe('C');
    expect(s.totalSeconds).toBe(510);
  });

  it('un sans-faute donne le maximum', () => {
    const s = scoreExam([{ domain: 'A', correct: true }], cert);
    expect(s.scaled).toBe(1000);
    expect(s.passed).toBe(true);
  });
});

describe('estimateReadiness', () => {
  it('donne plus de poids aux examens récents', () => {
    const r = estimateReadiness([700, 800, 850, 900, 950], cert);
    expect(r.estimate).toBe(880);
    expect(r.level).toBe('ready');
    expect(estimateReadiness([], cert).estimate).toBeNull();
    expect(estimateReadiness([800], cert).level).toBe('almost');
    expect(estimateReadiness([600], cert).level).toBe('not_ready');
  });
});
