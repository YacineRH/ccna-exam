import { describe, expect, it } from 'vitest';
import { startIndex } from './attempt';
import type { AttemptQuestion } from './types';

const q = (position: number, answered: boolean): AttemptQuestion => ({
  id: `q${position}`,
  position,
  domain: '1.0',
  body: { type: 'mcq_single', stem: 'Question de test assez longue', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] },
  response: answered ? { type: 'mcq_single', choice: 'a' } : null,
  flagged: false,
});

describe('startIndex', () => {
  it('reprend après la dernière question enregistrée en mode sans retour', () => {
    expect(startIndex({ allowBackNavigation: false, furthestPosition: 2, questions: [q(0, true), q(1, true), q(2, true), q(3, false)] })).toBe(3);
    expect(startIndex({ allowBackNavigation: false, furthestPosition: 0, questions: [q(0, false), q(1, false)] })).toBe(0);
    expect(startIndex({ allowBackNavigation: false, furthestPosition: 1, questions: [q(0, true), q(1, true)] })).toBe(1);
  });
  it('revient à la première question sans réponse en navigation libre', () => {
    expect(startIndex({ allowBackNavigation: true, furthestPosition: 3, questions: [q(0, true), q(1, false), q(2, true)] })).toBe(1);
    expect(startIndex({ allowBackNavigation: true, furthestPosition: 0, questions: [q(0, true)] })).toBe(0);
  });
});
