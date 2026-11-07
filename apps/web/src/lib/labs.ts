import type { LabDifficulty, LabSummary, TerminalLine } from './types';

/** Outils sans état de l'écran des labs CLI : filtres, historique ↑/↓ du terminal, collage. */

export const DIFFICULTY_LABEL: Record<LabDifficulty, string> = { easy: 'Facile', medium: 'Moyen', hard: 'Difficile' };

export type LabStatusFilter = 'all' | 'done' | 'todo';

export interface LabFilters {
  subtopic: string;
  difficulty: '' | LabDifficulty;
  status: LabStatusFilter;
}

export const NO_FILTERS: LabFilters = { subtopic: '', difficulty: '', status: 'all' };

export function filterLabs(labs: readonly LabSummary[], f: LabFilters): LabSummary[] {
  return labs.filter(
    (l) =>
      (!f.subtopic || l.subtopic === f.subtopic) &&
      (!f.difficulty || l.difficulty === f.difficulty) &&
      (f.status === 'all' || (f.status === 'done' ? l.done : !l.done)),
  );
}

/** Sous-thèmes couverts par au moins un lab, dans l'ordre de la liste. */
export function labSubtopics(labs: readonly LabSummary[]): { code: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const l of labs) if (!seen.has(l.subtopic)) seen.set(l.subtopic, l.subtopicName);
  return [...seen.entries()].map(([code, name]) => ({ code, name }));
}

/** Lab à proposer pour réviser un sous-thème : un lab pas encore réussi d'abord. */
export function labForSubtopic(labs: readonly LabSummary[], subtopic: string): LabSummary | null {
  const matching = labs.filter((l) => l.subtopic === subtopic);
  return matching.find((l) => !l.done) ?? matching[0] ?? null;
}

/**
 * Historique du terminal façon IOS : ↑ remonte vers les commandes plus anciennes, ↓ redescend ;
 * au-delà de la plus récente, on retrouve la saisie en cours. `index` vaut `history.length` hors historique.
 */
export function historyStep(history: readonly string[], index: number, direction: 'up' | 'down'): number {
  if (!history.length) return 0;
  if (direction === 'up') return Math.max(0, Math.min(index, history.length) - 1);
  return Math.min(history.length, index + 1);
}

/** Commandes déjà saisies sur un équipement, de la plus ancienne à la plus récente (sans doublon consécutif). */
export function inputHistory(transcript: readonly TerminalLine[], device: string): string[] {
  const out: string[] = [];
  for (const t of transcript) {
    if (t.device !== device || t.status === 'help') continue;
    const input = t.input.trim();
    if (!input || input === '\x1a' || out[out.length - 1] === input) continue;
    out.push(input);
  }
  return out;
}

/** Un collage multi-ligne : lignes non vides, sans retour chariot. */
export function pastedLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '');
}
