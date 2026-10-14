import type { QuestionBody } from '@examforge/core';
import { describe, expect, it } from 'vitest';
import { initialResponse, isComplete, moveItem, normalizeResponse, sameResponse, toggleChoice } from './responses';

const multi: QuestionBody = {
  type: 'mcq_multi',
  stem: 'Choisissez deux réponses correctes.',
  options: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
    { id: 'c', text: 'C' },
  ],
  selectCount: 2,
};

const ordering: QuestionBody = {
  type: 'ordering',
  stem: 'Remettez dans l’ordre les étapes.',
  items: [
    { id: 'x', text: 'X' },
    { id: 'y', text: 'Y' },
  ],
};

describe('toggleChoice', () => {
  it('limite la sélection à selectCount en retirant la plus ancienne', () => {
    expect(toggleChoice([], 'a', 2)).toEqual(['a']);
    expect(toggleChoice(['a', 'b'], 'c', 2)).toEqual(['b', 'c']);
    expect(toggleChoice(['a', 'b'], 'a', 2)).toEqual(['b']);
  });
});

describe('moveItem', () => {
  it('monte et descend dans les bornes', () => {
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('normalizeResponse', () => {
  it('renvoie null quand rien n’est saisi', () => {
    expect(normalizeResponse(null)).toBeNull();
    expect(normalizeResponse({ type: 'mcq_multi', choices: [] })).toBeNull();
    expect(normalizeResponse({ type: 'fill_blank', fields: { a: '  ', b: '' } })).toBeNull();
    expect(normalizeResponse({ type: 'cli', lines: ['', ' '] })).toBeNull();
    expect(normalizeResponse({ type: 'matching', pairs: { l1: '' } })).toBeNull();
  });
  it('nettoie les champs', () => {
    expect(normalizeResponse({ type: 'fill_blank', fields: { a: ' 10.0.0.1 ', b: '' } })).toEqual({
      type: 'fill_blank',
      fields: { a: '10.0.0.1' },
    });
    expect(normalizeResponse({ type: 'cli', lines: [' enable ', 'conf t', '', ''] })).toEqual({
      type: 'cli',
      lines: ['enable', 'conf t'],
    });
    expect(normalizeResponse({ type: 'matching', pairs: { l1: 'r2', l2: '' } })).toEqual({
      type: 'matching',
      pairs: { l1: 'r2' },
    });
  });
});

describe('construction et complétude', () => {
  it('un classement démarre sur l’ordre affiché', () => {
    expect(initialResponse(ordering, null)).toEqual({ type: 'ordering', order: ['x', 'y'] });
    expect(initialResponse(multi, null)).toBeNull();
    expect(initialResponse(multi, { type: 'mcq_multi', choices: ['a'] })).toEqual({ type: 'mcq_multi', choices: ['a'] });
  });
  it('un QCM multiple est complet avec exactement selectCount choix', () => {
    expect(isComplete(multi, { type: 'mcq_multi', choices: ['a'] })).toBe(false);
    expect(isComplete(multi, { type: 'mcq_multi', choices: ['a', 'c'] })).toBe(true);
    expect(isComplete(multi, null)).toBe(false);
  });
  it('compare deux réponses après normalisation', () => {
    expect(sameResponse({ type: 'cli', lines: ['a', ''] }, { type: 'cli', lines: [' a'] })).toBe(true);
    expect(sameResponse(null, { type: 'mcq_multi', choices: [] })).toBe(true);
  });
});
