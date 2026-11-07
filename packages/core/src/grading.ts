import { commandMatches } from './cli.js';
import { normalizeIpv4 } from './ipv4.js';
import type { AnswerKey } from './question.js';
import type { Response } from './response.js';

export { responseSchema, type Response } from './response.js';



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
  if (mode === 'int') {
    // Séparateurs de milliers usuels en français : espace, espace insécable, espace fine.
    const digits = v.replace(/[\s\u00a0\u202f\u2009]/g, '');
    return /^-?\d+$/.test(digits) ? String(Number(digits)) : null;
  }
  return v.toLowerCase().replace(/\s+/g, ' ');
}

function ratio(ok: number, total: number): GradeResult {
  const partial = total === 0 ? 0 : ok / total;
  return { correct: total > 0 && ok === total, partial };
}

/** Associe chaque commande attendue à une ligne saisie, sans tenir compte de l'ordre. */
function matchUnordered(lines: readonly string[], expected: readonly (readonly string[])[]): { ok: number; extra: number } {
  const remaining = [...lines];
  let ok = 0;
  for (const accepted of expected) {
    const idx = remaining.findIndex((l) => commandMatches(l, accepted));
    if (idx >= 0) {
      ok++;
      remaining.splice(idx, 1);
    }
  }
  return { ok, extra: remaining.length };
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
        const free = new Map((key.freeOrder ?? []).map(([start, end]) => [start, end]));
        for (let i = 0; i < key.commands.length; i++) {
          const end = free.get(i);
          if (end !== undefined) {
            // Plage à ordre libre : mêmes lignes attendues, dans n'importe quel ordre.
            ok += matchUnordered(lines.slice(i, end + 1), key.commands.slice(i, end + 1)).ok;
            i = end;
            continue;
          }
          const line = lines[i];
          if (line !== undefined && commandMatches(line, key.commands[i] as string[])) ok++;
        }
        const result = ratio(ok, key.commands.length);
        return lines.length === key.commands.length ? result : { correct: false, partial: result.partial };
      }
      const { ok, extra } = matchUnordered(lines, key.commands);
      const result = ratio(ok, key.commands.length);
      return extra === 0 ? result : { correct: false, partial: result.partial };
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
