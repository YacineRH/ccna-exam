/**
 * Révision espacée des questions de la banque (flashcards / QCM rapides), sans I/O.
 *
 * Algorithme : système de Leitner à intervalles doublés. Une carte vit dans une boîte (1 à 7) ;
 * une bonne réponse la fait monter d'une boîte et double l'intervalle (1, 2, 4, 8, 16, 32, 64 jours),
 * une erreur la renvoie en boîte 1 (intervalle d'un jour). La prochaine échéance dépend donc de la
 * réussite et de l'intervalle précédent.
 *
 * Pourquoi Leitner plutôt que SM-2 : les cartes sont des questions corrigées automatiquement (juste
 * ou faux), sans auto-évaluation de 0 à 5. SM-2 tire son facteur de facilité de cette note ; la
 * déduire d'un QCM (temps de réponse, réussite partielle) serait arbitraire. Leitner n'a besoin que
 * de la réussite, ses intervalles sont prévisibles et s'expliquent au candidat (« boîte 3 sur 7 »).
 *
 * Les échéances tombent à minuit, heure locale du candidat : une carte due « dans 2 jours » l'est
 * dès le matin du surlendemain, quelle que soit l'heure de la révision.
 */

export const LEITNER_INTERVALS_DAYS = [1, 2, 4, 8, 16, 32, 64] as const;
export const LEITNER_BOXES = LEITNER_INTERVALS_DAYS.length;
/** Boîte à partir de laquelle une carte est dite « maîtrisée ». */
export const MASTERED_BOX = 5;

export interface CardState {
  /** 0 : carte nouvelle, jamais révisée ; 1 à 7 : boîte de Leitner. */
  box: number;
  /** Intervalle appliqué à la dernière révision, en jours (0 pour une carte nouvelle). */
  intervalDays: number;
  /** Échéance : la carte est due à partir de cet instant. */
  dueAt: Date;
  reviews: number;
  lapses: number;
  lastReviewedAt: Date | null;
}

const DAY_MS = 86_400_000;

/**
 * Minuit local du jour de `now` décalé de `days` jours, en UTC.
 * `tzOffsetMinutes` suit `Date.prototype.getTimezoneOffset` : -60 pour Paris en hiver, -120 en été.
 */
export function localMidnight(now: Date, days: number, tzOffsetMinutes = 0): Date {
  const local = now.getTime() - tzOffsetMinutes * 60_000;
  const startOfLocalDay = Math.floor(local / DAY_MS) * DAY_MS;
  return new Date(startOfLocalDay + days * DAY_MS + tzOffsetMinutes * 60_000);
}

/** Carte ajoutée au paquet : due tout de suite. */
export function newCard(now: Date): CardState {
  return { box: 0, intervalDays: 0, dueAt: now, reviews: 0, lapses: 0, lastReviewedAt: null };
}

/** Nouvel état après une révision. */
export function reviewCard(state: CardState, correct: boolean, now: Date, tzOffsetMinutes = 0): CardState {
  const box = correct ? Math.min(Math.max(state.box, 0) + 1, LEITNER_BOXES) : 1;
  const intervalDays = LEITNER_INTERVALS_DAYS[box - 1] as number;
  return {
    box,
    intervalDays,
    dueAt: localMidnight(now, intervalDays, tzOffsetMinutes),
    reviews: state.reviews + 1,
    lapses: state.lapses + (correct ? 0 : 1),
    lastReviewedAt: now,
  };
}

export function isDue(state: Pick<CardState, 'dueAt'>, now: Date): boolean {
  return state.dueAt.getTime() <= now.getTime();
}

/** Bornes d'un paquet : 10 à 20 cartes par sous-thème (moins si la banque n'en a pas assez). */
export const DECK_MIN = 10;
export const DECK_MAX = 20;

/**
 * Cartes d'un paquet : au plus `DECK_MAX` questions du sous-thème, choisies de façon stable
 * (même paquet pour tous, d'une fois sur l'autre) par une empreinte de leur identifiant.
 */
export function pickDeck<T extends { id: string }>(questions: readonly T[], max = DECK_MAX): T[] {
  const hash = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
    return h;
  };
  return [...questions].sort((a, b) => hash(a.id) - hash(b.id) || a.id.localeCompare(b.id)).slice(0, max);
}
