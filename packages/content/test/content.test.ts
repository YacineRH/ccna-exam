import { describe, expect, it } from 'vitest';
import { allocateByWeight, assembleExam, grade, type PoolQuestion, type Question, type Response } from '@examforge/core';
import { listCertificationCodes, loadCertification } from '../src/index.js';

/** Construit la bonne réponse à partir de la correction, pour vérifier que chaque question est « gagnable ». */
function perfectResponse(q: Question): Response {
  const key = q.key;
  switch (key.type) {
    case 'mcq_single':
      return { type: 'mcq_single', choice: key.correct };
    case 'mcq_multi':
      return { type: 'mcq_multi', choices: key.correct };
    case 'fill_blank':
      return {
        type: 'fill_blank',
        fields: Object.fromEntries(Object.entries(key.fields).map(([id, f]) => [id, f.accepted[0] as string])),
      };
    case 'cli':
      return { type: 'cli', lines: key.commands.map((c) => c[0] as string) };
    case 'ordering':
      return { type: 'ordering', order: key.order };
    case 'matching':
      return { type: 'matching', pairs: key.pairs };
  }
}

describe.each(listCertificationCodes())('contenu %s', (code) => {
  const { certification, questions } = loadCertification(code);

  it('se charge sans erreur et couvre tous les domaines', () => {
    expect(questions.length).toBeGreaterThan(0);
    for (const d of certification.domains) {
      expect(questions.some((q) => q.domain === d.code), `aucune question pour ${d.code}`).toBe(true);
    }
  });

  it.each(questions.map((q) => [q.slug, q] as const))('%s : la bonne réponse obtient tous les points', (_slug, q) => {
    expect(grade(q.key, perfectResponse(q))).toEqual({ correct: true, partial: 1 });
  });

  it('explique chaque distracteur', () => {
    const missing: string[] = [];
    for (const q of questions) {
      if (q.body.type === 'mcq_single' || q.body.type === 'mcq_multi') {
        const correct = q.key.type === 'mcq_single' ? [q.key.correct] : q.key.type === 'mcq_multi' ? q.key.correct : [];
        for (const o of q.body.options) if (!correct.includes(o.id) && !q.distractorNotes[o.id]?.trim()) missing.push(`${q.slug}:${o.id}`);
      }
      // En association, un élément de droite qui ne sert à rien est un leurre : il doit être expliqué.
      if (q.body.type === 'matching' && q.key.type === 'matching') {
        const used = new Set(Object.values(q.key.pairs));
        for (const r of q.body.right) if (!used.has(r.id) && !q.distractorNotes[r.id]?.trim()) missing.push(`${q.slug}:${r.id}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

/** Ce dont l'assemblage a besoin, à partir de la banque du dépôt (le slug sert d'identifiant). */
const poolOf = (questions: Question[]): PoolQuestion[] =>
  questions.map((q) => ({ id: q.slug, domain: q.domain, type: q.body.type, difficulty: q.difficulty, subtopic: q.subtopic ?? null }));

describe('ccna', () => {
  const { certification, questions } = loadCertification('ccna');
  const count = (pred: (q: Question) => boolean) => questions.filter(pred).length;

  it('la banque permet deux examens complets sans doublon', () => {
    const pool = poolOf(questions);
    const size = certification.examFormat.questionCount;
    for (const seed of [1, 2, 3, 42, 2026]) {
      const first = assembleExam(pool, certification, { seed });
      const second = assembleExam(pool, certification, { seed: seed + 1000, avoidIds: first });
      expect(first).toHaveLength(size);
      expect(second).toHaveLength(size);
      expect(new Set([...first, ...second]).size, `seed ${seed}`).toBe(2 * size);
    }
  });

  it('a au moins deux fois la part de chaque domaine dans un examen complet', () => {
    const plan = allocateByWeight(certification.domains, certification.examFormat.questionCount);
    // Minimums demandés pour le CCNA (deux fois la répartition officielle de 102 questions, arrondie).
    const asked: Record<string, number> = { '1.0': 41, '2.0': 41, '3.0': 52, '4.0': 21, '5.0': 31, '6.0': 21 };
    for (const d of certification.domains) {
      const n = count((q) => q.domain === d.code);
      expect(n, `domaine ${d.code}`).toBeGreaterThanOrEqual(2 * (plan.get(d.code) ?? 0));
      expect(n, `domaine ${d.code}`).toBeGreaterThanOrEqual(asked[d.code] ?? 0);
    }
  });

  it('couvre chaque sous-thème par au moins deux questions', () => {
    const thin = certification.domains
      .flatMap((d) => d.subtopics.map((s) => ({ code: s.code, n: count((q) => q.subtopic === s.code) })))
      .filter((s) => s.n < 2);
    expect(thin).toEqual([]);
    expect(questions.every((q) => q.subtopic !== undefined)).toBe(true);
  });

  it('varie les types de questions', () => {
    const byType = (t: Question['body']['type']) => count((q) => q.body.type === t);
    expect(byType('cli')).toBeGreaterThanOrEqual(20);
    expect(byType('fill_blank')).toBeGreaterThanOrEqual(20);
    expect(byType('ordering')).toBeGreaterThanOrEqual(15);
    expect(byType('matching')).toBeGreaterThanOrEqual(15);
    // Le reste en QCM, dont au moins 15 % de la banque en réponses multiples.
    expect(byType('mcq_multi') / questions.length).toBeGreaterThanOrEqual(0.15);
    expect(byType('mcq_single')).toBeGreaterThan(byType('mcq_multi'));
  });

  it('cite une référence (RFC, norme IEEE ou documentation Cisco) pour chaque question', () => {
    expect(questions.filter((q) => !q.reference?.trim()).map((q) => q.slug)).toEqual([]);
  });

  it('dose les difficultés : environ 30 % faciles, 50 % moyennes, 20 % difficiles', () => {
    const share = (d: Question['difficulty']) => count((q) => q.difficulty === d) / questions.length;
    expect(share('easy')).toBeGreaterThanOrEqual(0.25);
    expect(share('easy')).toBeLessThanOrEqual(0.35);
    expect(share('medium')).toBeGreaterThanOrEqual(0.45);
    expect(share('medium')).toBeLessThanOrEqual(0.55);
    expect(share('hard')).toBeGreaterThanOrEqual(0.15);
    expect(share('hard')).toBeLessThanOrEqual(0.25);
  });

  it('reprend les pondérations officielles du 200-301', () => {
    const { certification } = loadCertification('ccna');
    expect(Object.fromEntries(certification.domains.map((d) => [d.code, d.weight]))).toEqual({
      '1.0': 0.2,
      '2.0': 0.2,
      '3.0': 0.25,
      '4.0': 0.1,
      '5.0': 0.15,
      '6.0': 0.1,
    });
  });

  it('accepte une saisie CLI abrégée pour la question ACL', () => {
    const { questions } = loadCertification('ccna');
    const acl = questions.find((q) => q.slug === 'ccna-5.6-extended-acl-placement-001') as Question;
    const lines = [
      'ip access-list ext BLOCK-WEB',
      'deny tcp 192.168.10.0 0.0.0.255 host 10.1.1.80 eq www',
      'permit ip any any',
      'int g0/0/0',
      'ip access-group BLOCK-WEB in',
    ];
    expect(grade(acl.key, { type: 'cli', lines }).correct).toBe(true);
    expect(grade(acl.key, { type: 'cli', lines: [...lines.slice(0, 4), 'ip access-group BLOCK-WEB out'] }).correct).toBe(false);
  });
});
