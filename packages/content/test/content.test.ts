import { describe, expect, it } from 'vitest';
import { grade, type Question, type Response } from '@examforge/core';
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
});

describe('ccna', () => {
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
