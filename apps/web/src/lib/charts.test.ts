import { describe, expect, it } from 'vitest';
import { gaugeDash, gaugeMarker, lineChart, radarPoint, radarPolygon } from './charts';

describe('radar', () => {
  it('axe 0 en haut, sens horaire', () => {
    expect(radarPoint(0, 6, 1, 150, 150, 110)).toEqual({ x: 150, y: 40 });
    expect(radarPoint(1, 6, 1, 150, 150, 110)).toEqual({ x: 245.3, y: 95 });
    expect(radarPoint(3, 6, 0.5, 150, 150, 110)).toEqual({ x: 150, y: 205 });
  });
  it('borne les ratios', () => {
    expect(radarPolygon([2, -1], 0, 0, 10)).toBe('0,-10 0,0');
  });
});

describe('jauge', () => {
  it('reprend les valeurs de la maquette (766/1000, seuil 825)', () => {
    expect(gaugeDash(0.766, 84)).toEqual({ dash: 404.3, circumference: 527.8 });
    expect(gaugeMarker(0.825, 100, 100, 84)).toEqual({ x: 25.2, y: 61.9 });
  });
});

describe('lineChart', () => {
  it('répartit les points et ferme l’aire', () => {
    const c = lineChart([300, 1000], { width: 100, height: 50, min: 300, max: 1000, padX: 10, padY: 5 });
    expect(c.points).toEqual([
      { x: 10, y: 45 },
      { x: 90, y: 5 },
    ]);
    expect(c.line).toBe('M10 45L90 5');
    expect(c.area).toBe('M10 45L90 5L90 45L10 45Z');
  });
  it('un seul point est centré, aucun point = vide', () => {
    expect(lineChart([650], { width: 100, height: 50, min: 300, max: 1000 }).points[0]?.x).toBe(50);
    expect(lineChart([], { width: 100, height: 50, min: 0, max: 1 }).line).toBe('');
  });
});
