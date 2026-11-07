import type { AttemptState } from './types';

/** Position de départ : en mode sans retour, la première question encore accessible. */
export function startIndex(a: Pick<AttemptState, 'allowBackNavigation' | 'furthestPosition' | 'questions'>): number {
  const qs = a.questions;
  if (qs.length === 0) return 0;
  if (!a.allowBackNavigation) {
    const i = qs.findIndex((q) => q.position === a.furthestPosition);
    const at = i < 0 ? 0 : i;
    return qs[at]?.response !== null && at < qs.length - 1 ? at + 1 : at;
  }
  const unanswered = qs.findIndex((q) => q.response === null);
  return unanswered < 0 ? 0 : unanswered;
}

