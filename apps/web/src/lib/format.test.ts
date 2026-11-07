import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatDuration,
  formatHms,
  formatPercent,
  formatStopwatch,
  initials,
  masteryOf,
  optionLetter,
} from './format';

describe('formatClock', () => {
  it('affiche toujours heures, minutes, secondes', () => {
    expect(formatClock(5207)).toBe('01:26:47');
    expect(formatClock(59)).toBe('00:00:59');
    expect(formatClock(0)).toBe('00:00:00');
  });
  it('ne descend jamais sous zéro et ignore les fractions', () => {
    expect(formatClock(-12)).toBe('00:00:00');
    expect(formatClock(61.9)).toBe('00:01:01');
  });
});

describe('formatStopwatch', () => {
  it('affiche les dixièmes', () => {
    expect(formatStopwatch(14_640)).toBe('00:14.6');
    expect(formatStopwatch(61_000)).toBe('01:01.0');
  });
});

describe('formatDuration / formatHms', () => {
  it('choisit une unité lisible', () => {
    expect(formatDuration(42)).toBe('42 s');
    expect(formatDuration(114)).toBe('1 min 54');
    expect(formatDuration(120)).toBe('2 min');
    expect(formatDuration(6372)).toBe('1 h 46 min');
  });
  it('format horloge', () => {
    expect(formatHms(6372)).toBe('1:46:12');
    expect(formatHms(245)).toBe('4:05');
  });
});

describe('divers', () => {
  it('seuils de maîtrise', () => {
    expect(masteryOf(80)).toBe('ok');
    expect(masteryOf(79.9)).toBe('warn');
    expect(masteryOf(60)).toBe('warn');
    expect(masteryOf(59)).toBe('crit');
  });
  it('pourcentage à la française', () => {
    expect(formatPercent(82.5, 1).replace(/\s/g, ' ')).toBe('82,5 %');
  });
  it('initiales et lettres', () => {
    expect(initials('Yacine Rahmani')).toBe('YR');
    expect(initials('admin')).toBe('AD');
    expect(optionLetter(2)).toBe('C');
  });
});
