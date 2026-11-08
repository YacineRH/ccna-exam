import { z } from 'zod';
import { allocateByWeight, type PoolQuestion } from './assembly.js';
import { DIFFICULTIES, type CertificationConfig, type Difficulty } from './certification.js';
import { createRng, shuffle } from './random.js';

/**
 * Série d'examens blancs figés : N examens au format officiel, assemblés d'un coup pour qu'ils
 * soient vraiment différents (pas un simple tirage au hasard répété).
 *
 * Contraintes garanties :
 * - chaque examen suit la répartition officielle par domaine (`allocateByWeight`), sans doublon ;
 * - une question apparaît dans au plus `maxUses` examens, et chaque question de la banque sert au moins une fois ;
 * - deux examens ont au plus `maxOverlap` questions en commun.
 * Objectifs d'équilibre : dans chaque examen, sous-thèmes au prorata de la banque, difficultés au plus près
 * des parts visées, réutilisation répartie au mieux.
 *
 * Déterministe : un même seed et une même banque donnent la même série, quel que soit l'ordre de la banque.
 */

export interface SeriesOptions {
  seed: number;
  /** Nombre d'examens de la série. */
  examCount: number;
  /** Par défaut, le format officiel de la certification. */
  questionCount?: number;
  /** Nombre maximal d'examens dans lesquels une même question apparaît. */
  maxUses: number;
  /** Nombre maximal de questions communes à deux examens. */
  maxOverlap: number;
  /** Part visée de chaque difficulté dans un examen ; par défaut 30 % faciles, 50 % moyennes, 20 % difficiles. */
  difficultyShares?: Partial<Record<Difficulty, number>>;
}

export interface SeriesExamReport {
  number: number;
  byDomain: Record<string, number>;
  byDifficulty: Record<Difficulty, number>;
  byType: Record<string, number>;
  /** Sous-thèmes de la certification présents dans l'examen. */
  subtopicsCovered: number;
}

export interface SeriesReport {
  examCount: number;
  questionCount: number;
  poolSize: number;
  uses: {
    min: number;
    max: number;
    mean: number;
    /** Nombre de questions par nombre d'examens qui les contiennent. */
    histogram: Record<number, number>;
    /** Questions de la banque qui n'apparaissent dans aucun examen. */
    unused: string[];
  };
  overlap: {
    max: number;
    mean: number;
    /** Numéros des deux examens les plus proches. */
    maxPair: [number, number] | null;
    /** Nombre de paires d'examens par nombre de questions communes. */
    histogram: Record<number, number>;
  };
  subtopics: { total: number; minCovered: number; meanCovered: number };
  difficulty: Record<Difficulty, { min: number; max: number; mean: number }>;
  exams: SeriesExamReport[];
}

export interface SeriesResult {
  exams: string[][];
  report: SeriesReport;
}

/** La banque ne permet pas la série demandée : domaine en cause et nombre de questions manquantes. */
export class InsufficientBankError extends Error {
  constructor(
    public readonly domain: string,
    public readonly needed: number,
    public readonly available: number,
    message = `Domaine ${domain} : ${needed} questions nécessaires, ${available} disponibles (il en manque ${needed - available})`,
  ) {
    super(message);
    this.name = 'InsufficientBankError';
  }

  get missing(): number {
    return this.needed - this.available;
  }
}

/** Une contrainte de la série ne peut pas être tenue avec cette banque (recouvrement, banque trop grande…). */
export class SeriesConstraintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeriesConstraintError';
  }
}

export const DEFAULT_DIFFICULTY_SHARES: Record<Difficulty, number> = { easy: 0.3, medium: 0.5, hard: 0.2 };

interface Plan {
  questionCount: number;
  byDomain: Map<string, number>;
  byDifficulty: Map<Difficulty, number>;
}

function planFor(cert: CertificationConfig, questionCount: number, shares: Record<Difficulty, number>): Plan {
  const byDomain = allocateByWeight(cert.domains, questionCount);
  const byDifficulty = allocateByWeight(
    DIFFICULTIES.map((d) => ({ code: d, weight: shares[d] })).filter((d) => d.weight > 0),
    questionCount,
  ) as Map<Difficulty, number>;
  return { questionCount, byDomain, byDifficulty };
}

/** Questions utilisables par la série : types autorisés par la certification, triées pour ne pas dépendre de l'ordre reçu. */
function eligiblePool(pool: readonly PoolQuestion[], cert: CertificationConfig): PoolQuestion[] {
  const allowed = new Set(cert.allowedQuestionTypes);
  return pool.filter((q) => allowed.has(q.type)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Vérifie, avant tout assemblage, que la banque suffit : dans chaque domaine, de quoi remplir un examen,
 * et assez de questions pour que la série tienne sans dépasser `maxUses` utilisations.
 * Vérifie aussi qu'aucune question ne restera inutilisée faute de places.
 */
export function checkBankForSeries(pool: readonly PoolQuestion[], cert: CertificationConfig, options: SeriesOptions): void {
  const questionCount = options.questionCount ?? cert.examFormat.questionCount;
  const plan = allocateByWeight(cert.domains, questionCount);
  const eligible = eligiblePool(pool, cert);
  for (const d of cert.domains) {
    const k = plan.get(d.code) ?? 0;
    const n = eligible.filter((q) => q.domain === d.code).length;
    const needed = Math.max(k, Math.ceil((options.examCount * k) / options.maxUses));
    if (n < needed) throw new InsufficientBankError(d.code, needed, n);
    if (n > options.examCount * k) {
      throw new SeriesConstraintError(
        `Domaine ${d.code} : ${n} questions pour ${options.examCount * k} places dans la série, certaines ne serviraient jamais`,
      );
    }
  }
}

export function assembleSeries(pool: readonly PoolQuestion[], cert: CertificationConfig, options: SeriesOptions): SeriesResult {
  checkBankForSeries(pool, cert, options);
  const questionCount = options.questionCount ?? cert.examFormat.questionCount;
  const shares = { ...DEFAULT_DIFFICULTY_SHARES, ...options.difficultyShares };
  const plan = planFor(cert, questionCount, shares);
  const eligible = eligiblePool(pool, cert);
  const rng = createRng(options.seed);
  const E = options.examCount;

  // Index compacts : chaque question reçoit un rang, chaque domaine sa liste de rangs.
  const questions = eligible;
  const uses = new Int32Array(questions.length);
  const examsOf: number[][] = questions.map(() => []);
  const byDomain = new Map<string, number[]>();
  questions.forEach((q, i) => {
    const list = byDomain.get(q.domain) ?? [];
    list.push(i);
    byDomain.set(q.domain, list);
  });
  // Part de chaque sous-thème dans son domaine : l'examen en reçoit autant, à proportion.
  const subtopicSize = new Map<string, number>();
  for (const q of questions) {
    const key = `${q.domain}|${q.subtopic ?? ''}`;
    subtopicSize.set(key, (subtopicSize.get(key) ?? 0) + 1);
  }

  const exams: number[][] = [];
  for (let e = 0; e < E; e++) {
    const inExam = new Uint8Array(questions.length);
    const overlapWith = new Int32Array(e); // questions communes avec chaque examen précédent
    const diffCount = new Map<Difficulty, number>();
    const chosen: number[] = [];
    // L'ordre des domaines tourne d'un examen à l'autre : aucun domaine ne récupère toujours les restes.
    const domainOrder = cert.domains.map((d) => d.code);
    const shift = e % domainOrder.length;
    const rotated = [...domainOrder.slice(shift), ...domainOrder.slice(0, shift)];
    // Places restantes, pour doser les difficultés domaine après domaine.
    let slotsLeft = questionCount;

    for (const domain of rotated) {
      const k = plan.byDomain.get(domain) ?? 0;
      const candidates = byDomain.get(domain) ?? [];
      const n = candidates.length;
      const subCount = new Map<string, number>();
      let minUse = Infinity;
      for (const i of candidates) minUse = Math.min(minUse, uses[i] as number);
      // Bruit de départage fixé pour l'examen : déterministe, sans favoriser l'ordre alphabétique.
      const jitter = new Map(shuffle(rng, candidates).map((i, rank) => [i, rank / Math.max(1, n)]));

      for (let slot = 0; slot < k; slot++) {
        let best = -1;
        let bestCost = Infinity;
        for (const i of candidates) {
          if (inExam[i] || (uses[i] as number) >= options.maxUses) continue;
          const q = questions[i] as PoolQuestion;
          // 1. Réutilisation : on prend d'abord les questions les moins servies du domaine.
          let cost = 40 * ((uses[i] as number) - minUse);
          // 2. Recouvrement : coût croissant avec les questions déjà communes ; interdit au-delà du plafond.
          let blocked = false;
          for (const f of examsOf[i] as number[]) {
            const ov = (overlapWith[f] as number) + 1;
            if (ov > options.maxOverlap) blocked = true;
            cost += ov * ov * 0.5;
          }
          if (blocked) cost += 10_000;
          // 3. Sous-thèmes au prorata de leur taille dans la banque.
          const subKey = `${domain}|${q.subtopic ?? ''}`;
          const target = (k * (subtopicSize.get(subKey) ?? 0)) / n;
          const already = subCount.get(subKey) ?? 0;
          if (already + 1 > Math.ceil(target)) cost += 12 * (already + 1 - Math.ceil(target));
          else if (already === 0) cost -= 20;
          // 4. Difficultés : rester sous la part visée de l'examen.
          const dTarget = plan.byDifficulty.get(q.difficulty) ?? 0;
          const dCount = diffCount.get(q.difficulty) ?? 0;
          if (dCount + 1 > dTarget) cost += 25 * (dCount + 1 - dTarget);
          else cost -= 3 * ((dTarget - dCount) / Math.max(1, slotsLeft));
          cost += jitter.get(i) as number;
          if (cost < bestCost) {
            bestCost = cost;
            best = i;
          }
        }
        if (best < 0) throw new InsufficientBankError(domain, k, slot);
        const q = questions[best] as PoolQuestion;
        inExam[best] = 1;
        chosen.push(best);
        for (const f of examsOf[best] as number[]) overlapWith[f] = (overlapWith[f] as number) + 1;
        const subKey = `${domain}|${q.subtopic ?? ''}`;
        subCount.set(subKey, (subCount.get(subKey) ?? 0) + 1);
        diffCount.set(q.difficulty, (diffCount.get(q.difficulty) ?? 0) + 1);
        slotsLeft--;
      }
    }
    for (const i of chosen) {
      uses[i] = (uses[i] as number) + 1;
      (examsOf[i] as number[]).push(e);
    }
    exams.push(chosen);
  }

  repairSeries(exams, questions, examsOf, uses, options);

  const result = exams.map((ids) => shuffle(rng, ids.map((i) => (questions[i] as PoolQuestion).id)));
  const report = seriesReport(result, pool, cert);
  if (report.uses.unused.length) {
    throw new SeriesConstraintError(`${report.uses.unused.length} questions ne servent dans aucun examen (ex. ${report.uses.unused.slice(0, 3).join(', ')})`);
  }
  if (report.uses.max > options.maxUses) throw new SeriesConstraintError(`Une question sert dans ${report.uses.max} examens (plafond ${options.maxUses})`);
  if (report.overlap.max > options.maxOverlap) {
    throw new SeriesConstraintError(
      `Les examens ${report.overlap.maxPair?.join(' et ')} ont ${report.overlap.max} questions communes (plafond ${options.maxOverlap})`,
    );
  }
  return { exams: result, report };
}

/**
 * Seconde passe : tant qu'une question n'est dans aucun examen, ou que deux examens dépassent le plafond
 * de recouvrement, on échange une question d'un examen contre une autre du même domaine (même sous-thème
 * et même difficulté de préférence) qui ne crée pas de nouveau dépassement. Déterministe.
 */
function repairSeries(
  exams: number[][],
  questions: readonly PoolQuestion[],
  examsOf: number[][],
  uses: Int32Array,
  options: SeriesOptions,
): void {
  const overlapsAfter = (e: number, added: number) => {
    // Recouvrement de l'examen e avec chacun des examens qui contiennent `added`.
    const set = new Set(exams[e]);
    return (examsOf[added] as number[]).map((f) => (exams[f] as number[]).filter((i) => set.has(i)).length + 1);
  };
  const swap = (e: number, out: number, inn: number) => {
    const list = exams[e] as number[];
    list[list.indexOf(out)] = inn;
    examsOf[out] = (examsOf[out] as number[]).filter((f) => f !== e);
    (examsOf[inn] as number[]).push(e);
    uses[out] = (uses[out] as number) - 1;
    uses[inn] = (uses[inn] as number) + 1;
  };
  const similar = (a: PoolQuestion, b: PoolQuestion) =>
    (a.subtopic === b.subtopic ? 0 : 2) + (a.difficulty === b.difficulty ? 0 : 1);

  // 1. Questions jamais servies : elles remplacent, dans un examen, une question servie plusieurs fois.
  for (let i = 0; i < questions.length; i++) {
    if ((uses[i] as number) > 0) continue;
    const q = questions[i] as PoolQuestion;
    let done = false;
    for (let e = 0; e < exams.length && !done; e++) {
      const outs = (exams[e] as number[])
        .filter((j) => (questions[j] as PoolQuestion).domain === q.domain && (uses[j] as number) > 1)
        .sort((x, y) => similar(q, questions[x] as PoolQuestion) - similar(q, questions[y] as PoolQuestion) || (uses[y] as number) - (uses[x] as number));
      if (outs.length) {
        swap(e, outs[0] as number, i);
        done = true;
      }
    }
  }

  // 2. Paires au-delà du plafond de recouvrement.
  for (let guard = 0; guard < 2000; guard++) {
    let worst: [number, number, number] | null = null;
    const sets = exams.map((e) => new Set(e));
    for (let a = 0; a < exams.length; a++) {
      for (let b = a + 1; b < exams.length; b++) {
        let ov = 0;
        for (const i of sets[a] as Set<number>) if ((sets[b] as Set<number>).has(i)) ov++;
        if (ov > options.maxOverlap && (!worst || ov > worst[2])) worst = [a, b, ov];
      }
    }
    if (!worst) return;
    const [a, b] = worst;
    const common = (exams[a] as number[]).filter((i) => (exams[b] as number[]).includes(i));
    let fixed = false;
    for (const out of common) {
      const q = questions[out] as PoolQuestion;
      if ((uses[out] as number) <= 1) continue;
      const replacements = questions
        .map((_, i) => i)
        .filter((i) => {
          const r = questions[i] as PoolQuestion;
          return r.domain === q.domain && !(exams[b] as number[]).includes(i) && (uses[i] as number) < options.maxUses;
        })
        .sort((x, y) => similar(q, questions[x] as PoolQuestion) - similar(q, questions[y] as PoolQuestion) || (uses[x] as number) - (uses[y] as number) || x - y);
      for (const inn of replacements) {
        if (overlapsAfter(b, inn).every((ov) => ov <= options.maxOverlap)) {
          swap(b, out, inn);
          fixed = true;
          break;
        }
      }
      if (fixed) break;
    }
    if (!fixed) return; // assembleSeries signalera le dépassement restant
  }
}

/**
 * Rapport d'une série, quelle qu'en soit l'origine (assemblée à l'instant ou relue depuis un fichier) :
 * réutilisation par question, recouvrements entre examens, couverture des sous-thèmes et des difficultés.
 * La banque est réduite aux types autorisés par la certification.
 */
export function seriesReport(exams: readonly (readonly string[])[], bank: readonly PoolQuestion[], cert: CertificationConfig): SeriesReport {
  // Seules comptent les questions d'un type autorisé : les autres n'entrent jamais dans un examen.
  const pool = eligiblePool(bank, cert);
  const byId = new Map(pool.map((q) => [q.id, q]));
  const useCount = new Map<string, number>(pool.map((q) => [q.id, 0]));
  for (const exam of exams) for (const id of exam) useCount.set(id, (useCount.get(id) ?? 0) + 1);
  const values = [...useCount.values()];
  const usesHistogram: Record<number, number> = {};
  for (const v of values) usesHistogram[v] = (usesHistogram[v] ?? 0) + 1;

  const sets = exams.map((e) => new Set(e));
  const overlapHistogram: Record<number, number> = {};
  let maxOverlap = 0;
  let maxPair: [number, number] | null = null;
  let sum = 0;
  let pairs = 0;
  for (let a = 0; a < sets.length; a++) {
    for (let b = a + 1; b < sets.length; b++) {
      let ov = 0;
      for (const id of sets[a] as Set<string>) if ((sets[b] as Set<string>).has(id)) ov++;
      overlapHistogram[ov] = (overlapHistogram[ov] ?? 0) + 1;
      sum += ov;
      pairs++;
      if (maxPair === null || ov > maxOverlap) {
        maxPair = [a + 1, b + 1];
        maxOverlap = ov;
      }
    }
  }

  const allSubtopics = cert.domains.flatMap((d) => d.subtopics.map((s) => s.code));
  const examReports: SeriesExamReport[] = exams.map((exam, i) => {
    const byDomain: Record<string, number> = {};
    const byDifficulty = Object.fromEntries(DIFFICULTIES.map((d) => [d, 0])) as Record<Difficulty, number>;
    const byType: Record<string, number> = {};
    const subs = new Set<string>();
    for (const id of exam) {
      const q = byId.get(id);
      if (!q) continue;
      byDomain[q.domain] = (byDomain[q.domain] ?? 0) + 1;
      byDifficulty[q.difficulty]++;
      byType[q.type] = (byType[q.type] ?? 0) + 1;
      if (q.subtopic) subs.add(q.subtopic);
    }
    return { number: i + 1, byDomain, byDifficulty, byType, subtopicsCovered: allSubtopics.filter((s) => subs.has(s)).length };
  });
  const covered = examReports.map((r) => r.subtopicsCovered);
  const difficulty = Object.fromEntries(
    DIFFICULTIES.map((d) => {
      const counts = examReports.map((r) => r.byDifficulty[d]);
      return [d, { min: Math.min(...counts), max: Math.max(...counts), mean: round(counts.reduce((s, n) => s + n, 0) / Math.max(1, counts.length)) }];
    }),
  ) as SeriesReport['difficulty'];

  return {
    examCount: exams.length,
    questionCount: exams[0]?.length ?? 0,
    poolSize: pool.length,
    uses: {
      min: Math.min(...values),
      max: Math.max(...values),
      mean: round(values.reduce((s, n) => s + n, 0) / Math.max(1, values.length)),
      histogram: usesHistogram,
      unused: [...useCount].filter(([, n]) => n === 0).map(([id]) => id).sort(),
    },
    overlap: { max: maxOverlap, mean: round(sum / Math.max(1, pairs)), maxPair, histogram: overlapHistogram },
    subtopics: {
      total: allSubtopics.length,
      minCovered: Math.min(...covered),
      meanCovered: round(covered.reduce((s, n) => s + n, 0) / Math.max(1, covered.length)),
    },
    difficulty,
    exams: examReports,
  };
}

const round = (x: number) => Math.round(x * 100) / 100;

export interface SeriesConstraints {
  maxUses: number;
  maxOverlap: number;
  questionCount?: number;
}

/**
 * Contrôle d'une série figée (un fichier de contenu, par exemple) : chaque examen au format officiel,
 * répartition par domaine respectée, aucune question en double ni inconnue, plafonds de réutilisation et de
 * recouvrement tenus, chaque question de la banque servie au moins une fois. Renvoie la liste des écarts.
 */
export function checkSeries(
  exams: readonly (readonly string[])[],
  pool: readonly PoolQuestion[],
  cert: CertificationConfig,
  constraints: SeriesConstraints,
): string[] {
  const issues: string[] = [];
  const questionCount = constraints.questionCount ?? cert.examFormat.questionCount;
  const plan = allocateByWeight(cert.domains, questionCount);
  const byId = new Map(pool.map((q) => [q.id, q]));
  exams.forEach((exam, i) => {
    const at = `examen ${i + 1}`;
    if (exam.length !== questionCount) issues.push(`${at} : ${exam.length} questions au lieu de ${questionCount}`);
    if (new Set(exam).size !== exam.length) issues.push(`${at} : question en double`);
    const unknown = exam.filter((id) => !byId.has(id));
    if (unknown.length) issues.push(`${at} : questions inconnues ${unknown.slice(0, 3).join(', ')}`);
    const counts = new Map<string, number>();
    for (const id of exam) {
      const q = byId.get(id);
      if (q) counts.set(q.domain, (counts.get(q.domain) ?? 0) + 1);
    }
    for (const [domain, k] of plan) {
      if ((counts.get(domain) ?? 0) !== k) issues.push(`${at} : ${counts.get(domain) ?? 0} questions du domaine ${domain} au lieu de ${k}`);
    }
  });
  const report = seriesReport(exams, pool, cert);
  if (report.uses.unused.length) issues.push(`${report.uses.unused.length} questions publiées ne servent dans aucun examen`);
  if (report.uses.max > constraints.maxUses) issues.push(`une question sert dans ${report.uses.max} examens (plafond ${constraints.maxUses})`);
  if (report.overlap.max > constraints.maxOverlap) {
    issues.push(`les examens ${report.overlap.maxPair?.join(' et ')} ont ${report.overlap.max} questions communes (plafond ${constraints.maxOverlap})`);
  }
  return issues;
}

/**
 * Fichier d'une série figée (`data/exams/<certification>.json`) : le seed et les plafonds qui l'ont produite,
 * puis chaque examen, numéroté de 1 à N, avec ses questions (slugs) dans l'ordre de passage.
 */
export const examSeriesSchema = z
  .object({
    certification: z.string().min(1),
    seed: z.number().int().nonnegative(),
    constraints: z.object({
      maxUses: z.number().int().positive(),
      maxOverlap: z.number().int().nonnegative(),
    }),
    exams: z
      .array(
        z.object({
          number: z.number().int().positive(),
          title: z.string().min(1),
          questions: z.array(z.string().min(1)).min(1),
        }),
      )
      .min(1),
  })
  .superRefine((series, ctx) => {
    series.exams.forEach((exam, i) => {
      if (exam.number !== i + 1) ctx.addIssue({ code: 'custom', message: `examen en position ${i + 1} numéroté ${exam.number}` });
    });
  });

export type ExamSeries = z.infer<typeof examSeriesSchema>;

export function parseExamSeries(input: unknown): ExamSeries {
  return examSeriesSchema.parse(input);
}
