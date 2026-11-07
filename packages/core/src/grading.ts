import { z } from 'zod';
import { commandMatches } from './cli.js';
import { normalizeIpv4 } from './ipv4.js';
import type { AnswerKey } from './question.js';

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

export interface GradeResult {
  /** Bonne réponse au sens de l'examen : tout ou rien. */
  correct: boolean;
  /** Part de la réponse juste, entre 0 et 1 (utile en entraînement). */
  partial: number;
}

const WRONG: GradeResult = { correct: false, partial: 0 };

function normalizeField(value: string, mode: 'text' | 'ipv4' | 'int'): string | null {
  const v = value.trim();
  if (mode === 'ipv4') return normalizeIpv4(v);
  if (mode === 'int') return /^-?\d+$/.test(v) ? String(Number(v)) : null;
  return v.toLowerCase().replace(/\s+/g, ' ');
}

function ratio(ok: number, total: number): GradeResult {
  const partial = total === 0 ? 0 : ok / total;
  return { correct: total > 0 && ok === total, partial };
}

/** Corrige une réponse. Une réponse d'un autre type que la question est fausse. */
export function grade(key: AnswerKey, response: Response | null | undefined): GradeResult {
  if (!response || response.type !== key.type) return WRONG;

  switch (key.type) {
    case 'mcq_single':
      return response.type === 'mcq_single' && response.choice === key.correct
        ? { correct: true, partial: 1 }
        : WRONG;

    case 'mcq_multi': {
      if (response.type !== 'mcq_multi') return WRONG;
      const picked = new Set(response.choices);
      // Cocher plus de cases que demandé ne doit jamais rapporter de points.
      if (picked.size > key.correct.length) return WRONG;
      const hits = key.correct.filter((c) => picked.has(c)).length;
      return ratio(hits, key.correct.length);
    }

    case 'fill_blank': {
      if (response.type !== 'fill_blank') return WRONG;
      const entries = Object.entries(key.fields);
      let ok = 0;
      for (const [id, spec] of entries) {
        const given = response.fields[id];
        if (given === undefined) continue;
        const norm = normalizeField(given, spec.normalize);
        if (norm !== null && spec.accepted.some((a) => normalizeField(a, spec.normalize) === norm)) ok++;
      }
      return ratio(ok, entries.length);
    }

    case 'cli': {
      if (response.type !== 'cli') return WRONG;
      const lines = response.lines.map((l) => l.trim()).filter(Boolean);
      if (key.ordered) {
        let ok = 0;
        key.commands.forEach((accepted, i) => {
          const line = lines[i];
          if (line !== undefined && commandMatches(line, accepted)) ok++;
        });
        const result = ratio(ok, key.commands.length);
        return lines.length === key.commands.length ? result : { correct: false, partial: result.partial };
      }
      const remaining = [...lines];
      let ok = 0;
      for (const accepted of key.commands) {
        const idx = remaining.findIndex((l) => commandMatches(l, accepted));
        if (idx >= 0) {
          ok++;
          remaining.splice(idx, 1);
        }
      }
      const result = ratio(ok, key.commands.length);
      return remaining.length === 0 ? result : { correct: false, partial: result.partial };
    }

    case 'ordering': {
      if (response.type !== 'ordering') return WRONG;
      const ok = key.order.filter((id, i) => response.order[i] === id).length;
      const result = ratio(ok, key.order.length);
      return response.order.length === key.order.length ? result : { correct: false, partial: result.partial };
    }

    case 'matching': {
      if (response.type !== 'matching') return WRONG;
      const entries = Object.entries(key.pairs);
      const ok = entries.filter(([l, r]) => response.pairs[l] === r).length;
      return ratio(ok, entries.length);
    }
  }
}
