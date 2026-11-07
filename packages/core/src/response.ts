import { z } from 'zod';

/*
 * Schéma de la réponse, à part de la notation : le navigateur note sans embarquer zod.
 */

/** Réponse envoyée par le candidat, du même type que la question. */
export const responseSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mcq_single'), choice: z.string().max(64) }),
  z.object({ type: z.literal('mcq_multi'), choices: z.array(z.string().max(64)).max(20) }),
  z.object({ type: z.literal('fill_blank'), fields: z.record(z.string().max(256)) }),
  z.object({ type: z.literal('cli'), lines: z.array(z.string().max(512)).max(50) }),
  z.object({ type: z.literal('ordering'), order: z.array(z.string().max(64)).max(50) }),
  z.object({ type: z.literal('matching'), pairs: z.record(z.string().max(64)) }),
]);
export type Response = z.infer<typeof responseSchema>;
