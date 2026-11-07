import { describe, expect, it } from 'vitest';
import { LabSession, toPublicLab } from '@examforge/core';
import { listLabCertificationCodes, loadCertification, loadLabs } from '../src/index.js';

/*
 * Chaque lab est joué ici, comme le ferait un candidat : état de départ, solution, variantes
 * documentées, pièges. `loadLabs` échoue déjà au moindre problème ; les tests ci-dessous détaillent.
 */

describe.each(listLabCertificationCodes())('labs %s', (code) => {
  const { profile, labs } = loadLabs(code);
  const { certification } = loadCertification(code);
  const subtopics = new Set(certification.domains.flatMap((d) => d.subtopics.map((s) => s.code)));

  it('se chargent, avec des slugs uniques et des sous-thèmes existants', () => {
    expect(labs.length).toBeGreaterThan(0);
    expect(new Set(labs.map((l) => l.slug)).size).toBe(labs.length);
    for (const lab of labs) expect(subtopics.has(lab.subtopic), `${lab.slug} : sous-thème ${lab.subtopic}`).toBe(true);
  });

  describe.each(labs.map((l) => [l.slug, l] as const))('%s', (_slug, lab) => {
    const play = (steps: typeof lab.solution) => {
      const s = new LabSession(profile, lab);
      const errors = s.runAll(steps).filter((r) => r.status === 'error');
      return { s, errors };
    };

    it('aucun objectif n’est atteint au départ', () => {
      expect(new LabSession(profile, lab).achieved()).toEqual([]);
    });

    it('sa solution est acceptée sans erreur et atteint tous les objectifs', () => {
      const { s, errors } = play(lab.solution);
      expect(errors.map((e) => `${e.echo}\n${e.output}`)).toEqual([]);
      expect(s.achieved()).toEqual(lab.objectives.map((o) => o.id));
    });

    it.each(lab.variants.map((v) => [v.description, v] as const))('variante « %s » : réussit aussi', (_d, v) => {
      const { s, errors } = play(v.solution);
      expect(errors.map((e) => `${e.echo}\n${e.output}`)).toEqual([]);
      expect(s.achieved()).toEqual(lab.objectives.map((o) => o.id));
    });

    it.each(lab.pitfalls.map((p) => [p.description, p] as const))('piège « %s » : échoue', (_d, p) => {
      const { s } = play(p.solution);
      for (const id of p.failing) expect(s.achieved(), `${id} ne devrait pas être atteint`).not.toContain(id);
      expect(s.complete()).toBe(false);
    });

    it('une solution incomplète échoue', () => {
      // Sans la dernière commande qui modifie l'état, au moins un objectif reste ouvert.
      for (const step of lab.solution) {
        for (let cut = step.commands.length - 1; cut >= 0; cut--) {
          const shorter = lab.solution.map((x) => (x === step ? { ...x, commands: x.commands.filter((_c, i) => i !== cut) } : x));
          const { s } = play(shorter);
          if (!s.complete()) return;
        }
      }
      throw new Error('aucune commande de la solution n’est indispensable');
    });

    it('trois indices, et aucun ne recopie toute la solution', () => {
      expect(lab.hints).toHaveLength(3);
      const all = lab.solution.flatMap((s) => s.commands).filter((c) => c.length > 3);
      for (const h of lab.hints) expect(all.every((c) => h.includes(c)), h).toBe(false);
    });

    it('la version publique ne contient ni solution, ni indices, ni explication', () => {
      const pub = JSON.stringify(toPublicLab(lab));
      expect(pub).not.toContain(lab.explanation);
      for (const h of lab.hints) expect(pub).not.toContain(h);
      expect(pub).not.toContain('"solution"');
      expect(pub).not.toContain('"check"');
    });
  });
});
