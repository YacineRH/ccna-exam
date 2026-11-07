import { describe, expect, it } from 'vitest';
import { filterLabs, historyStep, inputHistory, labForSubtopic, labSubtopics, NO_FILTERS, pastedLines } from './labs';
import type { LabSummary, TerminalLine } from './types';

const lab = (over: Partial<LabSummary>): LabSummary => ({
  slug: 'x',
  title: 'X',
  difficulty: 'easy',
  domain: '2.0',
  subtopic: '2.1',
  subtopicName: 'VLAN',
  estimatedMinutes: 5,
  objectiveCount: 3,
  devices: ['S1'],
  attempts: 0,
  done: false,
  bestSeconds: null,
  inProgress: null,
  ...over,
});

describe('filtres de la liste des labs', () => {
  const labs = [
    lab({ slug: 'a', subtopic: '2.1', difficulty: 'easy', done: true }),
    lab({ slug: 'b', subtopic: '2.2', subtopicName: 'Trunk', difficulty: 'medium' }),
    lab({ slug: 'c', subtopic: '2.1', difficulty: 'hard' }),
  ];
  it('sous-thème, difficulté, faits ou à faire', () => {
    expect(filterLabs(labs, NO_FILTERS).map((l) => l.slug)).toEqual(['a', 'b', 'c']);
    expect(filterLabs(labs, { ...NO_FILTERS, subtopic: '2.1' }).map((l) => l.slug)).toEqual(['a', 'c']);
    expect(filterLabs(labs, { ...NO_FILTERS, difficulty: 'medium' }).map((l) => l.slug)).toEqual(['b']);
    expect(filterLabs(labs, { ...NO_FILTERS, status: 'done' }).map((l) => l.slug)).toEqual(['a']);
    expect(filterLabs(labs, { ...NO_FILTERS, status: 'todo', subtopic: '2.1' }).map((l) => l.slug)).toEqual(['c']);
  });
  it('sous-thèmes couverts, et lab proposé pour réviser', () => {
    expect(labSubtopics(labs)).toEqual([
      { code: '2.1', name: 'VLAN' },
      { code: '2.2', name: 'Trunk' },
    ]);
    expect(labForSubtopic(labs, '2.1')?.slug).toBe('c');
    expect(labForSubtopic(labs, '9.9')).toBeNull();
    expect(labForSubtopic([lab({ slug: 'd', done: true })], '2.1')?.slug).toBe('d');
  });
});

describe('historique du terminal', () => {
  const history = ['enable', 'conf t', 'int g0/1'];
  it('↑ remonte, ↓ redescend jusqu’à la saisie en cours', () => {
    let i = history.length;
    i = historyStep(history, i, 'up');
    expect(history[i]).toBe('int g0/1');
    i = historyStep(history, i, 'up');
    i = historyStep(history, i, 'up');
    i = historyStep(history, i, 'up');
    expect(history[i]).toBe('enable');
    i = historyStep(history, i, 'down');
    expect(history[i]).toBe('conf t');
    i = historyStep(history, historyStep(history, i, 'down'), 'down');
    expect(i).toBe(history.length);
    expect(historyStep([], 0, 'up')).toBe(0);
  });
  it('se reconstruit depuis la transcription, sans l’aide ni Ctrl+Z', () => {
    const t = (device: string, input: string, status: TerminalLine['status'] = 'ok'): TerminalLine => ({ device, input, echo: input, output: '', status });
    expect(inputHistory([t('R1', 'en'), t('R1', 'en'), t('R2', 'conf t'), t('R1', 'ip ?', 'help'), t('R1', '\x1a'), t('R1', 'show run')], 'R1')).toEqual(['en', 'show run']);
  });
  it('collage multi-ligne', () => {
    expect(pastedLines('enable\r\nconf t\n\n  int g0/1  \n')).toEqual(['enable', 'conf t', '  int g0/1']);
  });
});
