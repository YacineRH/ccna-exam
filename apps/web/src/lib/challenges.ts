import type { ChallengeMode, LabSummary, LabTimes } from './types';

/** Outils sans état des challenges chronométrés : compte à rebours, annonces, filtres, courbe des temps. */

export const MODE_LABEL: Record<ChallengeMode, string> = { build: 'Construction', troubleshoot: 'Dépannage' };

/** Secondes restantes avant l'échéance, à l'heure du serveur ; jamais négatif. */
export function remainingSeconds(deadlineAt: string, serverNowMs: number): number {
  return Math.max(0, Math.ceil((Date.parse(deadlineAt) - serverNowMs) / 1000));
}

/**
 * Annonce aux lecteurs d'écran : le compte à rebours ne parle pas chaque seconde, seulement aux paliers
 * (5 min, 1 min, 10 s) et à l'échéance. Renvoie le palier franchi entre deux mesures, ou null.
 */
export const COUNTDOWN_STEPS = [300, 60, 10, 0] as const;
export function countdownAnnouncement(previous: number, current: number): string | null {
  const crossed = COUNTDOWN_STEPS.find((s) => previous > s && current <= s);
  if (crossed === undefined) return null;
  if (crossed === 0) return 'Temps écoulé : le challenge est terminé.';
  if (crossed === 300) return 'Il reste 5 minutes.';
  if (crossed === 60) return 'Attention : il reste 1 minute.';
  return 'Il reste 10 secondes.';
}

/** Palier critique : en dessous, le compte à rebours passe en alerte (couleur et icône). */
export const COUNTDOWN_WARNING = 60;

export type ChallengeStatusFilter = 'all' | 'done' | 'todo';
export interface ChallengeFilters {
  subtopic: string;
  difficulty: '' | LabSummary['difficulty'];
  mode: '' | ChallengeMode;
  status: ChallengeStatusFilter;
}
export const NO_CHALLENGE_FILTERS: ChallengeFilters = { subtopic: '', difficulty: '', mode: '', status: 'all' };

export function filterChallenges(list: readonly LabSummary[], f: ChallengeFilters): LabSummary[] {
  return list.filter(
    (c) =>
      (!f.subtopic || c.subtopic === f.subtopic) &&
      (!f.difficulty || c.difficulty === f.difficulty) &&
      (!f.mode || c.challenge?.mode === f.mode) &&
      (f.status === 'all' || (f.status === 'done' ? c.done : !c.done)),
  );
}

/** Temps cible battu ? (en secondes, à la seconde près). */
export function beatsTarget(seconds: number | null, targetMinutes: number | null): boolean {
  return seconds !== null && targetMinutes !== null && seconds <= targetMinutes * 60;
}

/** Points de la courbe des temps : un essai réussi = son temps ; les essais non réussis ne sont pas tracés. */
export function timeSeries(t: LabTimes): { values: number[]; labels: string[] } {
  const wins = t.times.filter((x) => x.success && x.durationSeconds !== null);
  return { values: wins.map((x) => x.durationSeconds as number), labels: wins.map((x) => x.startedAt) };
}
