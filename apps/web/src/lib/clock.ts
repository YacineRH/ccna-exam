/**
 * Chrono corrigé du décalage d'horloge client/serveur.
 *
 * L'échéance d'un examen est fixée par le serveur. Si l'horloge du poste avance ou retarde,
 * un décompte basé sur `Date.now()` serait faux d'autant. On estime donc le décalage au
 * chargement de la tentative grâce à `serverNow`, puis on décompte en heure serveur.
 * Chaque enregistrement de réponse renvoie aussi `serverNow` : le décalage est recalculé à
 * chaque fois, ce qui rattrape une horloge de poste modifiée en cours d'examen (mise en veille,
 * resynchronisation NTP, changement manuel).
 */

/**
 * Décalage (ms) à ajouter à l'heure locale pour obtenir l'heure du serveur.
 * `serverNow` a été produit pendant la requête : on le compare au milieu de l'aller-retour,
 * ce qui retire la moitié de la latence réseau de l'estimation.
 */
export function clockOffset(serverNow: string, requestStartedAt: number, responseReceivedAt: number): number {
  const server = Date.parse(serverNow);
  if (!Number.isFinite(server)) return 0;
  const midpoint = requestStartedAt + Math.max(0, responseReceivedAt - requestStartedAt) / 2;
  return Math.round(server - midpoint);
}

/**
 * Nouveau décalage après un échange avec le serveur. Une réponse sans `serverNow` lisible
 * (ancienne API, proxy…) garde le décalage précédent au lieu de le remettre à zéro.
 */
export function resyncOffset(
  previousMs: number,
  serverNow: string | null | undefined,
  requestStartedAt: number,
  responseReceivedAt: number,
): number {
  if (!serverNow || !Number.isFinite(Date.parse(serverNow))) return previousMs;
  return clockOffset(serverNow, requestStartedAt, responseReceivedAt);
}

/** Heure serveur estimée (ms) à partir de l'heure locale. */
export function serverTime(clientNow: number, offsetMs: number): number {
  return clientNow + offsetMs;
}

/** Secondes restantes avant l'échéance (jamais négatif) ; `null` sans échéance. */
export function remainingSeconds(deadlineAt: string | null, clientNow: number, offsetMs: number): number | null {
  if (deadlineAt === null) return null;
  const deadline = Date.parse(deadlineAt);
  if (!Number.isFinite(deadline)) return null;
  return Math.max(0, Math.round((deadline - serverTime(clientNow, offsetMs)) / 1000));
}

/** Intervalle du recalage périodique du chrono d'examen. */
export const RESYNC_INTERVAL_MS = 5 * 60_000;

/** Ce qu'il faut d'un document pour savoir quand l'onglet redevient visible (le vrai, ou un double de test). */
export interface VisibilitySource {
  readonly visibilityState: DocumentVisibilityState | string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

/**
 * Recalage léger du chrono : toutes les `intervalMs` (5 min), et dès que l'onglet redevient visible
 * (le navigateur ralentit les minuteries d'un onglet caché, et une veille du poste fait sauter son horloge).
 * Renvoie la fonction d'arrêt.
 */
export function scheduleClockResync(
  sync: () => void,
  { intervalMs = RESYNC_INTERVAL_MS, visibility }: { intervalMs?: number; visibility?: VisibilitySource } = {},
): () => void {
  const timer = setInterval(sync, intervalMs);
  const onVisible = () => {
    if (visibility?.visibilityState === 'visible') sync();
  };
  visibility?.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(timer);
    visibility?.removeEventListener('visibilitychange', onVisible);
  };
}
