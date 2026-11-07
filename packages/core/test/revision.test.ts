import { describe, expect, it } from 'vitest';
import { isDue, LEITNER_INTERVALS_DAYS, localMidnight, newCard, pickDeck, reviewCard } from '../src/index.js';

const at = (iso: string) => new Date(iso);

describe('révision espacée (Leitner)', () => {
  it('une carte nouvelle est due tout de suite', () => {
    const now = at('2026-03-10T15:00:00Z');
    const c = newCard(now);
    expect(c.box).toBe(0);
    expect(isDue(c, now)).toBe(true);
  });

  it('chaque bonne réponse monte d’une boîte et double l’intervalle, jusqu’à la dernière boîte', () => {
    let c = newCard(at('2026-03-10T15:00:00Z'));
    const intervals: number[] = [];
    let now = at('2026-03-10T15:00:00Z');
    for (let i = 0; i < 9; i++) {
      c = reviewCard(c, true, now);
      intervals.push(c.intervalDays);
      now = c.dueAt;
    }
    expect(intervals).toEqual([1, 2, 4, 8, 16, 32, 64, 64, 64]);
    expect(c.box).toBe(LEITNER_INTERVALS_DAYS.length);
    expect(c.reviews).toBe(9);
    expect(c.lapses).toBe(0);
  });

  it('une erreur remet la carte en boîte 1, quel que soit son intervalle', () => {
    let c = newCard(at('2026-03-10T15:00:00Z'));
    for (let i = 0; i < 4; i++) c = reviewCard(c, true, at('2026-03-10T15:00:00Z'));
    expect(c.intervalDays).toBe(8);
    c = reviewCard(c, false, at('2026-03-20T09:00:00Z'));
    expect(c.box).toBe(1);
    expect(c.intervalDays).toBe(1);
    expect(c.lapses).toBe(1);
    expect(c.dueAt.toISOString()).toBe('2026-03-21T00:00:00.000Z');
    // Puis elle repart : 2 jours après la réussite suivante.
    c = reviewCard(c, true, at('2026-03-21T10:00:00Z'));
    expect(c.box).toBe(2);
    expect(c.dueAt.toISOString()).toBe('2026-03-23T00:00:00.000Z');
  });

  it('l’échéance tombe à minuit, heure locale du candidat', () => {
    // 23 h 30 à Paris (UTC+1) le 10 mars = 22 h 30 UTC : l'échéance d'un jour est le 11 mars à minuit, heure de Paris.
    const c = reviewCard(newCard(at('2026-03-10T22:30:00Z')), true, at('2026-03-10T22:30:00Z'), -60);
    expect(c.dueAt.toISOString()).toBe('2026-03-10T23:00:00.000Z');
    // 0 h 30 à Paris le 11 mars = 23 h 30 UTC le 10 : c'est déjà le 11 en local, échéance le 12 à minuit local.
    const d = reviewCard(newCard(at('2026-03-10T23:30:00Z')), true, at('2026-03-10T23:30:00Z'), -60);
    expect(d.dueAt.toISOString()).toBe('2026-03-11T23:00:00.000Z');
    expect(localMidnight(at('2026-07-01T12:00:00Z'), 0, -120).toISOString()).toBe('2026-06-30T22:00:00.000Z');
  });

  it('une carte est due à partir de son échéance, pas avant', () => {
    const c = reviewCard(newCard(at('2026-03-10T15:00:00Z')), true, at('2026-03-10T15:00:00Z'));
    expect(isDue(c, at('2026-03-10T23:59:59Z'))).toBe(false);
    expect(isDue(c, at('2026-03-11T00:00:00Z'))).toBe(true);
  });

  it('paquet : au plus 20 cartes, choisies de façon stable', () => {
    const qs = Array.from({ length: 30 }, (_, i) => ({ id: `q-${i}` }));
    const a = pickDeck(qs);
    expect(a).toHaveLength(20);
    expect(pickDeck([...qs].reverse()).map((q) => q.id)).toEqual(a.map((q) => q.id));
    expect(pickDeck(qs.slice(0, 7))).toHaveLength(7);
  });
});
