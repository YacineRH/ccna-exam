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

/**
 * Modules de l'application qu'une certification propose. Le navigateur masque les autres
 * (navigation, tableau de bord, lancement) et l'API répond 404 sur leurs routes.
 * - `exam` : examens blancs (tirés ou figés) ; `practice` : entraînement libre ;
 * - `flashcards` : révision espacée ; `subnet` : entraîneur de subnetting IPv4 ;
 * - `cli` : labs dans le simulateur de terminal ; `challenges` : challenges chronométrés.
 */
export const MODULES = ['exam', 'practice', 'flashcards', 'subnet', 'cli', 'challenges'] as const;
export type Module = (typeof MODULES)[number];
/** Modules par défaut d'une certification déclarée sans liste : ceux qui ne demandent que des questions. */
export const DEFAULT_MODULES: readonly Module[] = ['exam', 'practice', 'flashcards'];

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
    /** Nom court affiché dans le sélecteur (« CCNA », « Security+ ») ; par défaut le code en capitales. */
    shortName: z.string().min(1).max(24).optional(),
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
    modules: z
      .array(z.enum(MODULES))
      .min(1)
      .default([...DEFAULT_MODULES]),
    /**
     * Sous-thèmes qu'un module d'entraînement exerce directement : la carte « À revoir » y propose un lien
     * vers le module (le subnetting pour l'adressage IPv4 du CCNA). Les labs CLI, eux, déclarent leur sous-thème.
     */
    moduleSubtopics: z.record(z.enum(MODULES), z.array(z.string().min(1))).optional(),
  })
  .superRefine((cert, ctx) => {
    const total = cert.domains.reduce((s, d) => s + d.weight, 0);
    if (Math.abs(total - 1) > 1e-6) {
      ctx.addIssue({ code: 'custom', message: `La somme des pondérations vaut ${total}, attendu 1` });
    }
    const codes = new Set<string>();
    // Les codes de sous-thèmes sont uniques dans toute la certification : le filtre `subtopics` s'appuie dessus.
    const subtopicCodes = new Set<string>();
    for (const d of cert.domains) {
      if (codes.has(d.code)) ctx.addIssue({ code: 'custom', message: `Domaine en double : ${d.code}` });
      codes.add(d.code);
      for (const s of d.subtopics) {
        if (subtopicCodes.has(s.code)) ctx.addIssue({ code: 'custom', message: `Sous-thème en double : ${s.code}` });
        subtopicCodes.add(s.code);
      }
    }
    for (const [module, codes] of Object.entries(cert.moduleSubtopics ?? {})) {
      if (!cert.modules.includes(module as Module)) ctx.addIssue({ code: 'custom', message: `moduleSubtopics : module ${module} absent de modules` });
      for (const c of codes ?? []) if (!subtopicCodes.has(c)) ctx.addIssue({ code: 'custom', message: `moduleSubtopics : sous-thème inconnu ${c}` });
    }
    if (new Set(cert.modules).size !== cert.modules.length) ctx.addIssue({ code: 'custom', message: 'Module en double' });
    if (cert.modules.includes('challenges') && !cert.modules.includes('cli'))
      ctx.addIssue({ code: 'custom', message: 'Le module challenges demande le module cli (même simulateur)' });
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
