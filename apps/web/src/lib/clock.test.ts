import { describe, expect, it } from 'vitest';
import { clockOffset, remainingSeconds, resyncOffset, serverTime } from './clock';

const T = Date.parse('2026-11-07T10:00:00.000Z');

describe('clockOffset', () => {
  it('vaut zéro quand les horloges sont synchronisées', () => {
    // Requête de 200 ms, réponse produite au milieu.
    expect(clockOffset(new Date(T + 100).toISOString(), T, T + 200)).toBe(0);
  });

  it('mesure un poste en retard ou en avance', () => {
    // Le poste retarde de 5 min : le serveur est en avance de 300 000 ms.
    expect(clockOffset(new Date(T + 300_000).toISOString(), T, T)).toBe(300_000);
    // Le poste avance de 2 min.
    expect(clockOffset(new Date(T - 120_000 + 50).toISOString(), T, T + 100)).toBe(-120_000);
  });

  it('retire la moitié de la latence réseau', () => {
    // Aller-retour de 2 s : l'heure serveur correspond au milieu, T + 1 s.
    expect(clockOffset(new Date(T + 1000).toISOString(), T, T + 2000)).toBe(0);
  });

  it('ignore une heure serveur illisible', () => {
    expect(clockOffset('pas une date', T, T + 10)).toBe(0);
  });
});

describe('resyncOffset', () => {
  it('remplace le décalage par la nouvelle mesure', () => {
    // Mesuré à +300 s au chargement ; le poste a depuis été remis à l'heure.
    expect(resyncOffset(300_000, new Date(T + 100).toISOString(), T, T + 200)).toBe(0);
  });

  it('rattrape une horloge de poste qui saute en cours d’examen', () => {
    const deadline = new Date(T + 3_600_000).toISOString();
    // Au chargement, horloges synchronisées : 1 h restante.
    const atLoad = resyncOffset(0, new Date(T).toISOString(), T, T);
    expect(remainingSeconds(deadline, T, atLoad)).toBe(3600);
    // 10 min plus tard côté serveur, le poste recule soudain d'1 h (veille, changement manuel).
    const client = T + 600_000 - 3_600_000;
    const afterSave = resyncOffset(atLoad, new Date(T + 600_000).toISOString(), client, client);
    expect(afterSave).toBe(3_600_000);
    // Sans recalage, le chrono afficherait 1 h 50 au lieu de 50 min.
    expect(remainingSeconds(deadline, client, atLoad)).toBe(6600);
    expect(remainingSeconds(deadline, client, afterSave)).toBe(3000);
  });

  it('garde le décalage précédent sans heure serveur exploitable', () => {
    expect(resyncOffset(42_000, undefined, T, T + 10)).toBe(42_000);
    expect(resyncOffset(42_000, null, T, T + 10)).toBe(42_000);
    expect(resyncOffset(42_000, 'pas une date', T, T + 10)).toBe(42_000);
  });
});

describe('remainingSeconds', () => {
  const deadline = new Date(T + 600_000).toISOString(); // échéance serveur : T + 10 min

  it('décompte en heure serveur', () => {
    expect(remainingSeconds(deadline, T, 0)).toBe(600);
    // Poste en retard de 5 min (offset +300 s) : il ne reste que 5 min côté serveur.
    expect(remainingSeconds(deadline, T, 300_000)).toBe(300);
    // Poste en avance de 2 min (offset −120 s) : il reste 12 min.
    expect(remainingSeconds(deadline, T, -120_000)).toBe(720);
  });

  it('ne descend jamais sous zéro et gère l’absence d’échéance', () => {
    expect(remainingSeconds(deadline, T + 3_600_000, 0)).toBe(0);
    expect(remainingSeconds(null, T, 0)).toBeNull();
    expect(remainingSeconds('?', T, 0)).toBeNull();
  });

  it('serverTime applique le décalage', () => {
    expect(serverTime(T, 1500)).toBe(T + 1500);
  });
});
