import { describe, expect, it } from 'vitest';
import { bestScores, examAriaLabel, examState, parseExamNumber, seriesCountLabel } from './series';
import type { SeriesExam, SeriesProgress } from './types';

const exam = (over: Partial<SeriesExam>): SeriesExam => ({
  number: 1,
  title: 'Examen blanc n° 1',
  questionCount: 102,
  taken: 0,
  bestScore: null,
  passed: false,
  lastAt: null,
  inProgress: null,
  ...over,
});

describe('série d’examens blancs', () => {
  it('distingue réussi, échoué, en cours et jamais passé', () => {
    expect(examState(exam({ taken: 1, bestScore: 900, passed: true }))).toBe('passed');
    expect(examState(exam({ taken: 2, bestScore: 700 }))).toBe('failed');
    expect(examState(exam({ inProgress: 'x' }))).toBe('in_progress');
    expect(examState(exam({}))).toBe('never');
    // Un examen déjà passé et repris reste « passé » : son meilleur score compte.
    expect(examState(exam({ taken: 1, bestScore: 900, passed: true, inProgress: 'x' }))).toBe('passed');
  });

  it('compte les examens passés', () => {
    expect(seriesCountLabel({ taken: 23, total: 100 })).toBe('23 / 100 passés');
    expect(seriesCountLabel({ taken: 1, total: 100 })).toBe('1 / 100 passé');
    expect(seriesCountLabel({ taken: 0, total: 100 })).toBe('0 / 100 passé');
  });

  it('nomme chaque case pour un lecteur d’écran', () => {
    expect(examAriaLabel(exam({ number: 42 }))).toBe('Examen n° 42, jamais passé');
    expect(examAriaLabel(exam({ number: 42, inProgress: 'x' }))).toBe('Examen n° 42, en cours');
    expect(examAriaLabel(exam({ number: 7, taken: 1, bestScore: 870, passed: true }))).toBe('Examen n° 7, passé, meilleur score 870, réussi');
    expect(examAriaLabel(exam({ number: 7, taken: 3, bestScore: 700 }))).toBe('Examen n° 7, passé 3 fois, meilleur score 700');
  });

  it('lit un numéro saisi', () => {
    expect(parseExamNumber('42', 100)).toBe(42);
    expect(parseExamNumber(' 7 ', 100)).toBe(7);
    expect(parseExamNumber('0', 100)).toBeNull();
    expect(parseExamNumber('101', 100)).toBeNull();
    expect(parseExamNumber('4.2', 100)).toBeNull();
    expect(parseExamNumber('', 100)).toBeNull();
  });

  it('garde les meilleurs scores des examens passés', () => {
    const progress: SeriesProgress = {
      certification: 'ccna',
      passingScore: 825,
      total: 3,
      taken: 2,
      passed: 1,
      nextNumber: 3,
      exams: [exam({ number: 1, taken: 1, bestScore: 850, passed: true }), exam({ number: 2, taken: 1, bestScore: 610 }), exam({ number: 3 })],
    };
    expect(bestScores(progress)).toEqual([
      { number: 1, score: 850, passed: true },
      { number: 2, score: 610, passed: false },
    ]);
  });
});
