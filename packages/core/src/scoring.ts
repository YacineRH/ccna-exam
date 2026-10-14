import type { CertificationConfig } from './certification.js';

export interface AnsweredItem {
  domain: string;
  correct: boolean;
  /** Secondes passées sur la question. */
  seconds?: number;
}

export interface DomainScore {
  domain: string;
  correct: number;
  total: number;
  /** Pourcentage de réussite, de 0 à 100. */
  percent: number;
}

export interface ExamScore {
  correct: number;
  total: number;
  /** Score ramené au barème de la certification (ex. 300–1000 pour Cisco). */
  scaled: number;
  passed: boolean;
  /** Écart au seuil : positif si réussi. */
  margin: number;
  byDomain: DomainScore[];
  weakestDomain: string | null;
  totalSeconds: number;
}

export function toScaled(ratio: number, scoring: CertificationConfig['scoring']): number {
  const r = Math.min(1, Math.max(0, ratio));
  return Math.round(scoring.min + (scoring.max - scoring.min) * r);
}

/**
 * Note un examen. Le score de chaque domaine est pondéré par son poids officiel :
 * un examen qui tomberait légèrement à côté de la répartition reste noté comme le vrai.
 */
export function scoreExam(items: readonly AnsweredItem[], cert: CertificationConfig): ExamScore {
  const byDomain: DomainScore[] = cert.domains.map((d) => {
    const mine = items.filter((i) => i.domain === d.code);
    const correct = mine.filter((i) => i.correct).length;
    return {
      domain: d.code,
      correct,
      total: mine.length,
      percent: mine.length ? Math.round((correct / mine.length) * 1000) / 10 : 0,
    };
  });

  const covered = cert.domains.filter((d) => items.some((i) => i.domain === d.code));
  const weightSum = covered.reduce((s, d) => s + d.weight, 0);
  const ratio = weightSum
    ? covered.reduce((s, d) => {
        const ds = byDomain.find((b) => b.domain === d.code) as DomainScore;
        return s + (d.weight / weightSum) * (ds.correct / ds.total);
      }, 0)
    : 0;

  const scaled = toScaled(ratio, cert.scoring);
  const scored = byDomain.filter((d) => d.total > 0);
  const weakest = scored.length ? scored.reduce((a, b) => (b.percent < a.percent ? b : a)) : null;

  return {
    correct: items.filter((i) => i.correct).length,
    total: items.length,
    scaled,
    passed: scaled >= cert.scoring.passing,
    margin: scaled - cert.scoring.passing,
    byDomain,
    weakestDomain: weakest?.domain ?? null,
    totalSeconds: items.reduce((s, i) => s + (i.seconds ?? 0), 0),
  };
}

export type ReadinessLevel = 'ready' | 'almost' | 'not_ready';

export interface Readiness {
  /** Moyenne pondérée des derniers examens, au barème de la certification. */
  estimate: number | null;
  level: ReadinessLevel;
  gap: number | null;
  examsConsidered: number;
}

/**
 * Niveau de préparation : moyenne des N derniers examens, les plus récents comptant davantage.
 * `recentScaledScores` est trié du plus ancien au plus récent.
 */
export function estimateReadiness(
  recentScaledScores: readonly number[],
  cert: CertificationConfig,
  window = 5,
): Readiness {
  const last = recentScaledScores.slice(-window);
  if (last.length === 0) return { estimate: null, level: 'not_ready', gap: null, examsConsidered: 0 };
  let num = 0;
  let den = 0;
  last.forEach((s, i) => {
    const w = i + 1;
    num += s * w;
    den += w;
  });
  const estimate = Math.round(num / den);
  const gap = estimate - cert.scoring.passing;
  const span = cert.scoring.max - cert.scoring.min;
  const level: ReadinessLevel = gap >= 0 ? 'ready' : gap >= -0.05 * span ? 'almost' : 'not_ready';
  return { estimate, level, gap, examsConsidered: last.length };
}
