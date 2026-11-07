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

  it('refuse un code de sous-thème présent dans deux domaines', () => {
    const twice = {
      ...cert,
      domains: [
        { code: 'A', name: 'A', weight: 0.5, subtopics: [{ code: 'x.1', name: 'X' }] },
        { code: 'B', name: 'B', weight: 0.5, subtopics: [{ code: 'x.1', name: 'X bis' }] },
      ],
    };
    expect(() => parseCertification(twice)).toThrow(/Sous-thème en double : x\.1/);
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

  describe('filtre types', () => {
    // A : 6 QCM simples + 2 QCM multiples, B : 6 QCM simples + 1 multiple, C : QCM simples uniquement.
    const mixed = pool(6).concat(
      { id: 'A-m0', domain: 'A', type: 'mcq_multi', difficulty: 'medium' },
      { id: 'A-m1', domain: 'A', type: 'mcq_multi', difficulty: 'medium' },
      { id: 'B-m0', domain: 'B', type: 'mcq_multi', difficulty: 'medium' },
      { id: 'C-cli', domain: 'C', type: 'cli', difficulty: 'medium' },
    );

    it('ne tire que les types demandés', () => {
      // Sans écarter C (poids 0,2, aucun QCM multiple), la répartition lui demanderait une question.
      const ids = assembleExam(mixed, cert, { seed: 5, questionCount: 3, types: ['mcq_multi'] });
      expect(ids.sort()).toEqual(['A-m0', 'A-m1', 'B-m0']);
    });

    it('écarte les domaines sans question du type et renormalise les poids', () => {
      // C n'a aucun QCM multiple : 2 questions réparties entre A (0,5) et B (0,3) seulement.
      const ids = assembleExam(mixed, cert, { seed: 9, questionCount: 2, types: ['mcq_multi'] });
      expect(ids).toHaveLength(2);
      expect(ids).toContain('B-m0');
      expect(ids.filter((id) => id.startsWith('A-m'))).toHaveLength(1);
    });

    it('reste combiné avec les types autorisés par la certification', () => {
      // `cli` n'est pas autorisé par la certification : le filtre ne peut pas le réintroduire.
      expect(() => assembleExam(mixed, cert, { seed: 1, questionCount: 1, types: ['cli'] })).toThrow(InsufficientQuestionsError);
      const ids = assembleExam(mixed, cert, { seed: 1, questionCount: 2, types: ['cli', 'mcq_multi'] });
      expect(ids.every((id) => id.includes('-m'))).toBe(true);
    });

    it('signale un manque global avec le domaine « * »', () => {
      try {
        assembleExam(mixed, cert, { seed: 1, questionCount: 1, types: ['ordering'] });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(InsufficientQuestionsError);
        expect((err as InsufficientQuestionsError).domain).toBe('*');
        expect((err as InsufficientQuestionsError).needed).toBe(1);
      }
    });

    it('signale toujours un domaine retenu mais trop pauvre', () => {
      expect(() => assembleExam(mixed, cert, { seed: 1, questionCount: 6, types: ['mcq_multi'] })).toThrow(InsufficientQuestionsError);
    });

    it('sans filtre, le comportement est inchangé', () => {
      expect(assembleExam(pool(20), cert, { seed: 1, types: [] })).toEqual(assembleExam(pool(20), cert, { seed: 1 }));
    });
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

describe('assembleExam : filtre subtopics', () => {
  // A : sous-thèmes A.1 (4 questions) et A.2 (2) ; B : B.1 (3) dont un QCM multiple ; C : sans sous-thème.
  const tagged: PoolQuestion[] = [
    ...['a0', 'a1', 'a2', 'a3'].map((id) => ({ id, domain: 'A', type: 'mcq_single' as const, difficulty: 'medium' as const, subtopic: 'A.1' })),
    ...['a4', 'a5'].map((id) => ({ id, domain: 'A', type: 'mcq_single' as const, difficulty: 'medium' as const, subtopic: 'A.2' })),
    { id: 'b0', domain: 'B', type: 'mcq_single', difficulty: 'easy', subtopic: 'B.1' },
    { id: 'b1', domain: 'B', type: 'mcq_single', difficulty: 'easy', subtopic: 'B.1' },
    { id: 'b2', domain: 'B', type: 'mcq_multi', difficulty: 'easy', subtopic: 'B.1' },
    ...['c0', 'c1', 'c2'].map((id) => ({ id, domain: 'C', type: 'mcq_single' as const, difficulty: 'medium' as const, subtopic: null })),
  ];

  it('ne tire que le sous-thème demandé, tout entier si on le demande', () => {
    const ids = assembleExam(tagged, cert, { seed: 3, questionCount: 4, subtopics: ['A.1'] });
    expect(ids.sort()).toEqual(['a0', 'a1', 'a2', 'a3']);
  });

  it('écarte les domaines sans question du sous-thème et renormalise les poids', () => {
    // A.2 (domaine A, poids 0,5) et B.1 (domaine B, poids 0,3), 3 questions : C est écarté, A en reçoit 2 et B 1.
    // Sans renormalisation, C (poids 0,2) en demanderait une et l'assemblage échouerait.
    const ids = assembleExam(tagged, cert, { seed: 11, questionCount: 3, subtopics: ['A.2', 'B.1'] });
    expect(ids.filter((id) => id.startsWith('a')).sort()).toEqual(['a4', 'a5']);
    expect(ids.filter((id) => id.startsWith('b'))).toHaveLength(1);
  });

  it('se combine avec le filtre types', () => {
    expect(assembleExam(tagged, cert, { seed: 1, questionCount: 1, subtopics: ['B.1'], types: ['mcq_multi'] })).toEqual(['b2']);
    expect(() => assembleExam(tagged, cert, { seed: 1, questionCount: 1, subtopics: ['A.1'], types: ['mcq_multi'] })).toThrow(
      InsufficientQuestionsError,
    );
  });

  it('signale « * » quand aucun domaine ne convient, et le domaine quand il est trop pauvre', () => {
    try {
      assembleExam(tagged, cert, { seed: 1, questionCount: 1, subtopics: ['Z.9'] });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InsufficientQuestionsError);
      expect((err as InsufficientQuestionsError).domain).toBe('*');
      expect((err as InsufficientQuestionsError).message).toContain('Z.9');
    }
    try {
      assembleExam(tagged, cert, { seed: 1, questionCount: 5, subtopics: ['A.1'] });
      expect.unreachable();
    } catch (err) {
      expect((err as InsufficientQuestionsError).domain).toBe('A');
      expect((err as InsufficientQuestionsError).available).toBe(4);
    }
  });

  it('sans filtre, les questions sans sous-thème restent tirables', () => {
    expect(assembleExam(tagged, cert, { seed: 1, subtopics: [] })).toEqual(assembleExam(tagged, cert, { seed: 1 }));
    expect(() => assembleExam(tagged, cert, { seed: 1, questionCount: 9, domains: ['C', 'A'] })).not.toThrow();
  });
});
