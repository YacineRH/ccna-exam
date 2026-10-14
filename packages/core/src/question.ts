import { z } from 'zod';
import { DIFFICULTIES } from './certification.js';

/**
 * Une question est découpée en deux :
 * - `body` : ce que le candidat voit (envoyé au navigateur) ;
 * - `key`  : la correction (ne quitte jamais le serveur avant la soumission).
 */

const choice = z.object({ id: z.string().min(1), text: z.string().min(1) });

const common = {
  stem: z.string().min(10),
  /** Sortie de commande, extrait de config ou description de topologie. */
  exhibit: z.string().optional(),
};

export const questionBodySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mcq_single'), ...common, options: z.array(choice).min(2) }),
  z.object({
    type: z.literal('mcq_multi'),
    ...common,
    options: z.array(choice).min(3),
    selectCount: z.number().int().min(2),
  }),
  z.object({
    type: z.literal('fill_blank'),
    ...common,
    fields: z.array(z.object({ id: z.string().min(1), label: z.string().min(1) })).min(1),
  }),
  z.object({
    type: z.literal('cli'),
    ...common,
    /** Prompt affiché, ex. "R1(config-if)#". */
    prompt: z.string().min(1),
    /** Nombre de commandes attendues (une par ligne). */
    lines: z.number().int().min(1),
  }),
  z.object({ type: z.literal('ordering'), ...common, items: z.array(choice).min(2) }),
  z.object({
    type: z.literal('matching'),
    ...common,
    left: z.array(choice).min(2),
    right: z.array(choice).min(2),
  }),
]);

export const fieldNormalizers = ['text', 'ipv4', 'int'] as const;

export const answerKeySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mcq_single'), correct: z.string() }),
  z.object({ type: z.literal('mcq_multi'), correct: z.array(z.string()).min(2) }),
  z.object({
    type: z.literal('fill_blank'),
    fields: z.record(
      z.object({
        accepted: z.array(z.string()).min(1),
        normalize: z.enum(fieldNormalizers).default('text'),
      }),
    ),
  }),
  z.object({
    type: z.literal('cli'),
    /** Pour chaque ligne attendue, les formes canoniques acceptées. */
    commands: z.array(z.array(z.string()).min(1)).min(1),
    /** Si faux, les lignes peuvent être données dans n'importe quel ordre. */
    ordered: z.boolean().default(true),
  }),
  z.object({ type: z.literal('ordering'), order: z.array(z.string()).min(2) }),
  z.object({ type: z.literal('matching'), pairs: z.record(z.string()) }),
]);

export const questionSchema = z
  .object({
    /** Identifiant stable et lisible, ex. "ccna-3.4-ospf-adjacency-001". */
    slug: z.string().regex(/^[a-z0-9.-]+$/),
    certification: z.string(),
    domain: z.string(),
    subtopic: z.string().optional(),
    difficulty: z.enum(DIFFICULTIES),
    body: questionBodySchema,
    key: answerKeySchema,
    explanation: z.string().min(20),
    /** Pourquoi chaque distracteur est faux (id d'option -> raison). */
    distractorNotes: z.record(z.string()).default({}),
    reference: z.string().optional(),
  })
  .superRefine((q, ctx) => {
    for (const issue of checkQuestionConsistency(q)) ctx.addIssue({ code: 'custom', message: issue });
  });

export type QuestionBody = z.infer<typeof questionBodySchema>;
export type AnswerKey = z.infer<typeof answerKeySchema>;
export type QuestionInput = z.input<typeof questionSchema>;
export type Question = z.infer<typeof questionSchema>;

/** Vérifie que la correction est cohérente avec l'énoncé (ids existants, comptes, doublons). */
export function checkQuestionConsistency(q: { body: QuestionBody; key: AnswerKey }): string[] {
  const issues: string[] = [];
  const { body, key } = q;
  if (body.type !== key.type) return [`type de correction (${key.type}) différent de l'énoncé (${body.type})`];

  const dupes = (ids: string[], what: string) => {
    if (new Set(ids).size !== ids.length) issues.push(`identifiants en double dans ${what}`);
  };
  const lower = (s: string) => s.trim().toLowerCase();

  switch (body.type) {
    case 'mcq_single':
    case 'mcq_multi': {
      const ids = body.options.map((o) => o.id);
      dupes(ids, 'les options');
      const texts = body.options.map((o) => lower(o.text));
      if (new Set(texts).size !== texts.length) issues.push('deux options ont le même texte');
      const correct = key.type === 'mcq_single' ? [key.correct] : key.type === 'mcq_multi' ? key.correct : [];
      for (const c of correct) if (!ids.includes(c)) issues.push(`réponse ${c} absente des options`);
      if (body.type === 'mcq_multi' && key.type === 'mcq_multi') {
        if (key.correct.length !== body.selectCount)
          issues.push(`selectCount=${body.selectCount} mais ${key.correct.length} bonnes réponses`);
        if (key.correct.length >= body.options.length) issues.push('aucun distracteur');
        dupes(key.correct, 'les bonnes réponses');
      }
      break;
    }
    case 'fill_blank': {
      if (key.type !== 'fill_blank') break;
      const ids = body.fields.map((f) => f.id);
      dupes(ids, 'les champs');
      for (const id of ids) if (!key.fields[id]) issues.push(`champ ${id} sans correction`);
      for (const id of Object.keys(key.fields)) if (!ids.includes(id)) issues.push(`correction pour un champ inconnu : ${id}`);
      break;
    }
    case 'cli': {
      if (key.type !== 'cli') break;
      if (key.commands.length !== body.lines)
        issues.push(`lines=${body.lines} mais ${key.commands.length} commandes attendues`);
      break;
    }
    case 'ordering': {
      if (key.type !== 'ordering') break;
      const ids = body.items.map((i) => i.id);
      dupes(ids, 'les éléments');
      if (key.order.length !== ids.length || !key.order.every((id) => ids.includes(id)))
        issues.push("l'ordre attendu ne reprend pas exactement les éléments");
      break;
    }
    case 'matching': {
      if (key.type !== 'matching') break;
      const left = body.left.map((i) => i.id);
      const right = body.right.map((i) => i.id);
      dupes(left, 'la colonne de gauche');
      dupes(right, 'la colonne de droite');
      for (const l of left) if (!key.pairs[l]) issues.push(`élément ${l} sans association`);
      for (const [l, r] of Object.entries(key.pairs)) {
        if (!left.includes(l)) issues.push(`association depuis un élément inconnu : ${l}`);
        if (!right.includes(r)) issues.push(`association vers un élément inconnu : ${r}`);
      }
      break;
    }
  }
  return issues;
}

export function parseQuestion(input: unknown): Question {
  return questionSchema.parse(input);
}
