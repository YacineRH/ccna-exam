import type { CertificationConfig, Difficulty, QuestionType } from './certification.js';
import { createRng, shuffle } from './random.js';

/** Ce dont l'assemblage a besoin d'une question : pas de contenu, juste de quoi trier. */
export interface PoolQuestion {
  id: string;
  domain: string;
  type: QuestionType;
  difficulty: Difficulty;
  /** Code du sous-thème, s'il est renseigné. Nécessaire pour le filtre `subtopics`. */
  subtopic?: string | null;
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
  /**
   * Restreint les types de questions (combiné avec `allowedQuestionTypes` de la certification).
   * Les domaines sans aucune question des types demandés sont écartés et les pondérations
   * des autres renormalisées : un type rare reste utilisable en entraînement ciblé.
   */
  types?: readonly QuestionType[];
  /**
   * Restreint l'examen à certains sous-thèmes (codes de la certification), sur le modèle de `types` :
   * une question sans sous-thème est écartée, les domaines sans question retenue aussi, et les
   * pondérations des autres sont renormalisées (réviser un seul sous-thème, par exemple).
   */
  subtopics?: readonly string[];
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
  /** `domain` vaut `*` quand aucun domaine ne peut fournir de question (filtre de types trop restrictif). */
  constructor(
    public readonly domain: string,
    public readonly needed: number,
    public readonly available: number,
    message = `Domaine ${domain} : ${needed} questions demandées, ${available} disponibles`,
  ) {
    super(message);
    this.name = 'InsufficientQuestionsError';
  }
}

/**
 * Tire un examen dans la banque : pondération officielle respectée, jamais deux fois la même
 * question, types limités à ceux autorisés par la certification (et aux filtres `types` et `subtopics`
 * s'ils sont fournis), questions déjà vues en dernier recours.
 */
export function assembleExam(
  pool: readonly PoolQuestion[],
  cert: CertificationConfig,
  options: AssembleOptions,
): string[] {
  const count = options.questionCount ?? cert.examFormat.questionCount;
  const allowed = new Set(
    options.types?.length ? cert.allowedQuestionTypes.filter((t) => options.types?.includes(t)) : cert.allowedQuestionTypes,
  );
  const subtopics = options.subtopics?.length ? new Set(options.subtopics) : null;
  const eligible = (q: PoolQuestion) =>
    allowed.has(q.type) &&
    (!options.difficulty || q.difficulty === options.difficulty) &&
    (!subtopics || (q.subtopic != null && subtopics.has(q.subtopic)));

  let domains = options.domains?.length
    ? cert.domains.filter((d) => options.domains?.includes(d.code))
    : cert.domains;
  if (domains.length === 0) throw new Error('Aucun domaine retenu');
  // Filtres ciblés (types, sous-thèmes) : seuls les domaines qui ont des questions retenues restent en lice.
  if (options.types?.length || subtopics) {
    domains = domains.filter((d) => pool.some((q) => q.domain === d.code && eligible(q)));
    if (domains.length === 0) {
      const filters = [
        ...(options.types?.length ? [`les types ${options.types.join(', ')}`] : []),
        ...(subtopics ? [`les sous-thèmes ${[...subtopics].join(', ')}`] : []),
      ];
      throw new InsufficientQuestionsError('*', count, 0, `Aucune question disponible pour ${filters.join(' et ')}`);
    }
  }

  const rng = createRng(options.seed);
  const avoid = new Set(options.avoidIds ?? []);
  const plan = allocateByWeight(domains, count);

  const picked: string[] = [];
  const seen = new Set<string>();
  for (const domain of domains) {
    const needed = plan.get(domain.code) ?? 0;
    if (needed === 0) continue;
    const candidates = pool.filter((q) => q.domain === domain.code && eligible(q) && !seen.has(q.id));
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
