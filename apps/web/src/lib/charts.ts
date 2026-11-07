/** Géométrie des graphiques SVG (pure, testée). */

export interface Point {
  x: number;
  y: number;
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Point d'un axe de radar : axe 0 en haut, sens horaire. `ratio` entre 0 et 1. */
export function radarPoint(index: number, count: number, ratio: number, cx: number, cy: number, radius: number): Point {
  const angle = -Math.PI / 2 + (2 * Math.PI * index) / count;
  const r = Math.max(0, Math.min(1, ratio)) * radius;
  return { x: round(cx + r * Math.cos(angle)), y: round(cy + r * Math.sin(angle)) };
}

export function radarPolygon(ratios: readonly number[], cx: number, cy: number, radius: number): string {
  return ratios.map((v, i) => radarPoint(i, ratios.length, v, cx, cy, radius)).map((p) => `${p.x},${p.y}`).join(' ');
}

export interface LineChart {
  points: Point[];
  line: string;
  area: string;
}

/** Courbe : `values` réparties sur [padX, width-padX], échelle verticale [min, max] -> [height-padY, padY]. */
export function lineChart(
  values: readonly number[],
  opts: { width: number; height: number; min: number; max: number; padX?: number; padY?: number },
): LineChart {
  const { width, height, min, max, padX = 20, padY = 10 } = opts;
  const span = max - min || 1;
  const yOf = (v: number) => round(height - padY - ((Math.max(min, Math.min(max, v)) - min) / span) * (height - 2 * padY));
  const n = values.length;
  const points = values.map((v, i) => ({
    x: round(n === 1 ? width / 2 : padX + (i * (width - 2 * padX)) / (n - 1)),
    y: yOf(v),
  }));
  if (points.length === 0) return { points, line: '', area: '' };
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('');
  const first = points[0] as Point;
  const last = points[points.length - 1] as Point;
  const base = height - padY;
  const area = `${line}L${last.x} ${base}L${first.x} ${base}Z`;
  return { points, line, area };
}

/** Ordonnée d'une valeur dans le même repère que `lineChart`. */
export function yFor(v: number, opts: { height: number; min: number; max: number; padY?: number }): number {
  const { height, min, max, padY = 10 } = opts;
  const span = max - min || 1;
  return round(height - padY - ((v - min) / span) * (height - 2 * padY));
}

/** Arc de jauge : longueur du trait pour une fraction d'un cercle de rayon r. */
export function gaugeDash(fraction: number, radius: number): { dash: number; circumference: number } {
  const circumference = 2 * Math.PI * radius;
  return { dash: round(Math.max(0, Math.min(1, fraction)) * circumference), circumference: round(circumference) };
}

/** Position d'un repère sur le pourtour d'une jauge démarrant en haut. */
export function gaugeMarker(fraction: number, cx: number, cy: number, radius: number): Point {
  const angle = -Math.PI / 2 + 2 * Math.PI * fraction;
  return { x: round(cx + radius * Math.cos(angle)), y: round(cy + radius * Math.sin(angle)) };
}
