import type { CertificationConfig, Difficulty, QuestionType } from './certification.js';
import { createRng, shuffle } from './random.js';

/** Ce dont l'assemblage a besoin d'une question : pas de contenu, juste de quoi trier. */
export interface PoolQuestion {
  id: string;
  domain: string;
  type: QuestionType;
  difficulty: Difficulty;
}

export interface AssembleOptions {
  seed: number;
  /** Par défaut, le format officiel de la certification. */
  questionCount?: number;
  /** Restreint l'examen à certains domaines (les pondérations sont renormalisées). */
  domains?: string[];
  /** Questions déjà vues, à éviter tant que la banque le permet. */
  avoidIds?: Iterable<string>;
  difficulty?: Difficulty;
}

/**
 * Répartit `count` questions entre les domaines selon leur pondération
 * (méthode du plus fort reste : la somme tombe toujours juste).
 */
export function allocateByWeight(
  domains: readonly { code: string; weight: number }[],
  count: number,
): Map<string, number> {
  const total = domains.reduce((s, d) => s + d.weight, 0);
  const raw = domains.map((d) => ({ code: d.code, exact: (d.weight / total) * count }));
  const result = new Map(raw.map((r) => [r.code, Math.floor(r.exact)]));
  let left = count - [...result.values()].reduce((s, n) => s + n, 0);
  const byRemainder = [...raw].sort((a, b) => (b.exact % 1) - (a.exact % 1) || a.code.localeCompare(b.code));
  for (const r of byRemainder) {
    if (left <= 0) break;
    result.set(r.code, (result.get(r.code) ?? 0) + 1);
    left--;
  }
  return result;
}

export class InsufficientQuestionsError extends Error {
  constructor(
    public readonly domain: string,
    public readonly needed: number,
    public readonly available: number,
  ) {
    super(`Domaine ${domain} : ${needed} questions demandées, ${available} disponibles`);
    this.name = 'InsufficientQuestionsError';
  }
}

/**
 * Tire un examen dans la banque : pondération officielle respectée, jamais deux fois la même
 * question, types limités à ceux autorisés par la certification, questions déjà vues en dernier recours.
 */
export function assembleExam(
  pool: readonly PoolQuestion[],
  cert: CertificationConfig,
  options: AssembleOptions,
): string[] {
  const count = options.questionCount ?? cert.examFormat.questionCount;
  const domains = options.domains?.length
    ? cert.domains.filter((d) => options.domains?.includes(d.code))
    : cert.domains;
  if (domains.length === 0) throw new Error('Aucun domaine retenu');

  const rng = createRng(options.seed);
  const avoid = new Set(options.avoidIds ?? []);
  const allowed = new Set(cert.allowedQuestionTypes);
  const plan = allocateByWeight(domains, count);

  const picked: string[] = [];
  const seen = new Set<string>();
  for (const domain of domains) {
    const needed = plan.get(domain.code) ?? 0;
    if (needed === 0) continue;
    const candidates = pool.filter(
      (q) =>
        q.domain === domain.code &&
        allowed.has(q.type) &&
        (!options.difficulty || q.difficulty === options.difficulty) &&
        !seen.has(q.id),
    );
    const fresh = shuffle(rng, candidates.filter((q) => !avoid.has(q.id)));
    const reused = shuffle(rng, candidates.filter((q) => avoid.has(q.id)));
    const chosen = [...fresh, ...reused].slice(0, needed);
    if (chosen.length < needed) throw new InsufficientQuestionsError(domain.code, needed, chosen.length);
    for (const q of chosen) {
      seen.add(q.id);
      picked.push(q.id);
    }
  }
  return shuffle(rng, picked);
}
