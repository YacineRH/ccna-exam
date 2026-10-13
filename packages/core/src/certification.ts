import { z } from 'zod';

/**
 * Une certification est une donnée de configuration, jamais du code.
 * Ajouter Security+, AWS, etc. = fournir un nouvel objet conforme à ce schéma.
 */

export const QUESTION_TYPES = [
  'mcq_single',
  'mcq_multi',
  'fill_blank',
  'cli',
  'ordering',
  'matching',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const subtopicSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
});

export const domainSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  /** Part de l'examen, entre 0 et 1. La somme des domaines vaut 1. */
  weight: z.number().positive().max(1),
  subtopics: z.array(subtopicSchema).default([]),
});

export const certificationSchema = z
  .object({
    code: z.string().regex(/^[a-z0-9-]+$/, 'code en minuscules, chiffres et tirets'),
    name: z.string().min(1),
    vendor: z.string().min(1),
    examCode: z.string().min(1),
    domains: z.array(domainSchema).min(1),
    scoring: z.object({
      min: z.number().int(),
      max: z.number().int(),
      passing: z.number().int(),
    }),
    examFormat: z.object({
      questionCount: z.number().int().positive(),
      durationMinutes: z.number().int().positive(),
      allowBackNavigation: z.boolean(),
    }),
    allowedQuestionTypes: z.array(z.enum(QUESTION_TYPES)).min(1),
  })
  .superRefine((cert, ctx) => {
    const total = cert.domains.reduce((s, d) => s + d.weight, 0);
    if (Math.abs(total - 1) > 1e-6) {
      ctx.addIssue({ code: 'custom', message: `La somme des pondérations vaut ${total}, attendu 1` });
    }
    const codes = new Set<string>();
    for (const d of cert.domains) {
      if (codes.has(d.code)) ctx.addIssue({ code: 'custom', message: `Domaine en double : ${d.code}` });
      codes.add(d.code);
    }
    const { min, max, passing } = cert.scoring;
    if (!(min < passing && passing <= max)) {
      ctx.addIssue({ code: 'custom', message: 'Barème incohérent : il faut min < passing <= max' });
    }
  });

export type CertificationConfig = z.infer<typeof certificationSchema>;
export type DomainConfig = z.infer<typeof domainSchema>;

export function parseCertification(input: unknown): CertificationConfig {
  return certificationSchema.parse(input);
}
