import type { SeriesExam, SeriesProgress } from './types';

/** État d'un examen de la série pour l'utilisateur. */
export type SeriesExamState = 'passed' | 'failed' | 'in_progress' | 'never';

export function examState(exam: SeriesExam): SeriesExamState {
  if (exam.taken > 0) return exam.passed ? 'passed' : 'failed';
  return exam.inProgress ? 'in_progress' : 'never';
}

/** « 23 / 100 passés » : examens terminés au moins une fois. */
export function seriesCountLabel(progress: Pick<SeriesProgress, 'taken' | 'total'>): string {
  return `${progress.taken} / ${progress.total} passé${progress.taken > 1 ? 's' : ''}`;
}

/** Nom accessible d'une case de la grille : numéro, état, meilleur score. */
export function examAriaLabel(exam: SeriesExam): string {
  const state = examState(exam);
  const base = `Examen n° ${exam.number}`;
  if (state === 'never') return `${base}, jamais passé`;
  if (state === 'in_progress') return `${base}, en cours`;
  const times = exam.taken > 1 ? `, passé ${exam.taken} fois` : ', passé';
  return `${base}${times}, meilleur score ${exam.bestScore}${state === 'passed' ? ', réussi' : ''}`;
}

/**
 * Numéro saisi au clavier : un entier de la série, sinon null (la saisie reste affichée, le lancement
 * est simplement désactivé).
 */
export function parseExamNumber(value: string, total: number): number | null {
  const v = value.trim();
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= total ? n : null;
}

/** Examens passés, du plus ancien numéro au plus récent, pour la courbe des meilleurs scores. */
export function bestScores(progress: SeriesProgress): { number: number; score: number; passed: boolean }[] {
  return progress.exams
    .filter((e) => e.bestScore !== null)
    .map((e) => ({ number: e.number, score: e.bestScore as number, passed: e.passed }));
}
