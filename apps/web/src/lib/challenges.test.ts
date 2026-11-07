import { describe, expect, it } from 'vitest';
import { beatsTarget, countdownAnnouncement, filterChallenges, NO_CHALLENGE_FILTERS, remainingSeconds, timeSeries } from './challenges';
import type { LabSummary } from './types';

const ch = (over: Partial<LabSummary>): LabSummary => ({
  slug: 'x',
  kind: 'challenge',
  challenge: { targetMinutes: 5, timeLimitMinutes: 10, mode: 'troubleshoot' },
  title: 'X',
  difficulty: 'easy',
  domain: '2.0',
  subtopic: '2.2',
  subtopicName: 'Trunk',
  estimatedMinutes: 5,
  objectiveCount: 3,
  devices: ['S1'],
  attempts: 0,
  done: false,
  bestSeconds: null,
  inProgress: null,
  ...over,
});

describe('compte à rebours d’un challenge', () => {
  it('secondes restantes à l’heure du serveur, jamais négatives', () => {
    const deadline = '2026-03-10T10:10:00.000Z';
    expect(remainingSeconds(deadline, Date.parse('2026-03-10T10:09:00.200Z'))).toBe(60);
    expect(remainingSeconds(deadline, Date.parse('2026-03-10T10:11:00Z'))).toBe(0);
  });

  it('n’annonce que les paliers : 5 min, 1 min, 10 s, échéance', () => {
    expect(countdownAnnouncement(302, 301)).toBeNull();
    expect(countdownAnnouncement(301, 300)).toBe('Il reste 5 minutes.');
    expect(countdownAnnouncement(120, 119)).toBeNull();
    expect(countdownAnnouncement(61, 59)).toBe('Attention : il reste 1 minute.');
    expect(countdownAnnouncement(11, 10)).toBe('Il reste 10 secondes.');
    expect(countdownAnnouncement(1, 0)).toBe('Temps écoulé : le challenge est terminé.');
    // Chaque seconde entre deux paliers reste silencieuse.
    const said = Array.from({ length: 600 }, (_, i) => countdownAnnouncement(600 - i, 599 - i)).filter(Boolean);
    expect(said).toHaveLength(4);
  });
});

describe('liste des challenges', () => {
  const list = [
    ch({ slug: 'a', done: true }),
    ch({ slug: 'b', challenge: { targetMinutes: 3, timeLimitMinutes: 6, mode: 'build' }, difficulty: 'medium' }),
    ch({ slug: 'c', subtopic: '3.4' }),
  ];
  it('filtres : sous-thème, difficulté, mode, faits ou à faire', () => {
    expect(filterChallenges(list, NO_CHALLENGE_FILTERS).map((c) => c.slug)).toEqual(['a', 'b', 'c']);
    expect(filterChallenges(list, { ...NO_CHALLENGE_FILTERS, mode: 'build' }).map((c) => c.slug)).toEqual(['b']);
    expect(filterChallenges(list, { ...NO_CHALLENGE_FILTERS, subtopic: '3.4' }).map((c) => c.slug)).toEqual(['c']);
    expect(filterChallenges(list, { ...NO_CHALLENGE_FILTERS, status: 'todo' }).map((c) => c.slug)).toEqual(['b', 'c']);
  });

  it('temps cible battu et courbe des seuls essais réussis', () => {
    expect(beatsTarget(300, 5)).toBe(true);
    expect(beatsTarget(301, 5)).toBe(false);
    expect(beatsTarget(null, 5)).toBe(false);
    const t = timeSeries({
      slug: 'a',
      kind: 'challenge',
      targetMinutes: 5,
      bestSeconds: 200,
      times: [
        { id: '1', startedAt: '2026-01-01', success: true, expired: false, durationSeconds: 400, hintsUsed: 0 },
        { id: '2', startedAt: '2026-01-02', success: false, expired: true, durationSeconds: 600, hintsUsed: 0 },
        { id: '3', startedAt: '2026-01-03', success: true, expired: false, durationSeconds: 200, hintsUsed: 0 },
      ],
    });
    expect(t.values).toEqual([400, 200]);
  });
});
