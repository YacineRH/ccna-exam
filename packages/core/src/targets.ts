import { z } from 'zod';
import { QUESTION_TYPES } from './certification.js';

/**
 * Cibles chiffrées de la banque et de la série d'une certification (`data/bank-targets/<code>.json`).
 * Les tests de contenu les lisent : mêmes vérifications pour toutes les certifications, seuls les chiffres changent.
 */
export const bankTargetsSchema = z.object({
  certification: z.string().min(1),
  description: z.string().optional(),
  bank: z.object({
    /** Questions publiées au minimum. */
    minQuestions: z.number().int().positive(),
    /** Écart toléré entre la part d'un domaine dans la banque et son poids officiel (0,01 = 1 point). */
    weightTolerance: z.number().min(0).max(0.2),
    minPerSubtopic: z.number().int().nonnegative(),
    /** Questions au minimum de chaque type autorisé dans chaque domaine. */
    minPerDomainType: z.number().int().nonnegative(),
    domainTypeExemptions: z.array(z.object({ domain: z.string(), type: z.enum(QUESTION_TYPES), reason: z.string().min(1) })).default([]),
    /** Part minimale des QCM à réponses multiples dans la banque. */
    minMultiShare: z.number().min(0).max(1),
    /** Questions `source: "ai"` au minimum (rédigées en lots puis relues). */
    minAiSource: z.number().int().nonnegative(),
    difficulty: z.object({
      easy: z.number(),
      medium: z.number(),
      hard: z.number(),
      bankTolerance: z.number(),
      domainTolerance: z.number(),
    }),
  }),
  series: z.object({
    exams: z.number().int().positive(),
    /** N : nombre d'examens par question, au plus. */
    maxUses: z.number().int().positive(),
    /** Questions communes à deux examens, au plus. */
    maxOverlap: z.number().int().nonnegative(),
    difficultyTolerance: z.number(),
    minSubtopicsPerExam: z.number().int().nonnegative(),
  }),
});

export type BankTargets = z.infer<typeof bankTargetsSchema>;

export function parseBankTargets(input: unknown): BankTargets {
  return bankTargetsSchema.parse(input);
}
