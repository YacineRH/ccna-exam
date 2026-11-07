import type { QuestionBody } from './question.js';
import { createRng, shuffle } from './random.js';

/**
 * Prépare l'énoncé envoyé au navigateur : jamais la correction, et un ordre d'affichage
 * mélangé (avec un seed stable par tentative) pour que la position ne trahisse pas la réponse.
 */
export function toPublicBody(body: QuestionBody, seed: number): QuestionBody {
  const rng = createRng(seed);
  switch (body.type) {
    case 'mcq_single':
    case 'mcq_multi':
      return { ...body, options: shuffle(rng, body.options) };
    case 'ordering':
      return { ...body, items: shuffle(rng, body.items) };
    case 'matching':
      return { ...body, right: shuffle(rng, body.right) };
    default:
      return body;
  }
}
