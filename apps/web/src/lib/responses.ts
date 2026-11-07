import type { QuestionBody, Response } from '@examforge/core';

/** Réponse de départ affichée pour une question (ordre courant pour un classement). */
export function initialResponse(body: QuestionBody, saved: Response | null): Response | null {
  if (saved && saved.type === body.type) return saved;
  if (body.type === 'ordering') return { type: 'ordering', order: body.items.map((i) => i.id) };
  return null;
}

/**
 * Nettoie une réponse avant envoi : champs vides retirés.
 * Renvoie null quand rien n'a été saisi (la question reste « non répondue »).
 */
export function normalizeResponse(response: Response | null): Response | null {
  if (!response) return null;
  switch (response.type) {
    case 'mcq_single':
      return response.choice ? response : null;
    case 'mcq_multi':
      return response.choices.length ? { type: 'mcq_multi', choices: [...new Set(response.choices)] } : null;
    case 'fill_blank': {
      const fields = Object.fromEntries(
        Object.entries(response.fields)
          .map(([k, v]) => [k, v.trim()] as const)
          .filter(([, v]) => v !== ''),
      );
      return Object.keys(fields).length ? { type: 'fill_blank', fields } : null;
    }
    case 'cli': {
      const lines = response.lines.map((l) => l.trim());
      while (lines.length && lines[lines.length - 1] === '') lines.pop();
      return lines.some(Boolean) ? { type: 'cli', lines } : null;
    }
    case 'ordering':
      return response.order.length ? response : null;
    case 'matching': {
      const pairs = Object.fromEntries(Object.entries(response.pairs).filter(([, v]) => v !== ''));
      return Object.keys(pairs).length ? { type: 'matching', pairs } : null;
    }
  }
}

/** Coche/décoche une option sans jamais dépasser `max` sélections (la plus ancienne est retirée). */
export function toggleChoice(choices: readonly string[], id: string, max: number): string[] {
  if (choices.includes(id)) return choices.filter((c) => c !== id);
  const next = [...choices, id];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Déplace l'élément `index` de `delta` positions (bornes respectées). */
export function moveItem<T>(items: readonly T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item as T);
  return next;
}

/** Une question est-elle entièrement renseignée (pour l'avertissement avant de terminer) ? */
export function isComplete(body: QuestionBody, response: Response | null): boolean {
  const r = normalizeResponse(response);
  if (!r || r.type !== body.type) return false;
  switch (body.type) {
    case 'mcq_single':
      return true;
    case 'mcq_multi':
      return r.type === 'mcq_multi' && r.choices.length === body.selectCount;
    case 'fill_blank':
      return r.type === 'fill_blank' && body.fields.every((f) => (r.fields[f.id] ?? '') !== '');
    case 'cli':
      return r.type === 'cli' && r.lines.filter(Boolean).length >= body.lines;
    case 'ordering':
      return true;
    case 'matching':
      return r.type === 'matching' && body.left.every((l) => r.pairs[l.id]);
  }
}

export function sameResponse(a: Response | null, b: Response | null): boolean {
  return JSON.stringify(normalizeResponse(a)) === JSON.stringify(normalizeResponse(b));
}

export const QUESTION_TYPE_LABEL: Record<QuestionBody['type'], string> = {
  mcq_single: 'QCM · RÉPONSE UNIQUE',
  mcq_multi: 'QCM · RÉPONSES MULTIPLES',
  fill_blank: 'TEXTE À COMPLÉTER',
  cli: 'CLI',
  ordering: 'CLASSEMENT',
  matching: 'ASSOCIATION',
};
