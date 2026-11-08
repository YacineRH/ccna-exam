import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkLab,
  checkSeries,
  parseCertification,
  parseExamSeries,
  parseLab,
  parseQuestion,
  parseTerminalProfile,
  type CertificationConfig,
  type ExamSeries,
  type Lab,
  type PoolQuestion,
  type Question,
  type TerminalProfile,
} from '@examforge/core';

/** Dossier `data/` du paquet, que l'on tourne depuis `src/` (tests) ou `dist/` (build). */
export const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

export interface ContentBundle {
  certification: CertificationConfig;
  questions: Question[];
}

export class ContentError extends Error {
  constructor(message: string, public readonly issues: string[]) {
    super(`${message}\n- ${issues.join('\n- ')}`);
    this.name = 'ContentError';
  }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

export function listCertificationCodes(dataDir = DATA_DIR): string[] {
  return readdirSync(join(dataDir, 'certifications'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

/**
 * Vérifie qu'une question est rangée au bon endroit : domaine et sous-thème existants,
 * type autorisé par la certification, notes de distracteurs qui pointent vers de vraies options.
 */
export function checkQuestionAgainstCertification(q: Question, cert: CertificationConfig): string[] {
  const issues: string[] = [];
  const at = `[${q.slug}]`;
  if (q.certification !== cert.code) issues.push(`${at} certification ${q.certification} au lieu de ${cert.code}`);
  const domain = cert.domains.find((d) => d.code === q.domain);
  if (!domain) issues.push(`${at} domaine inconnu : ${q.domain}`);
  else if (q.subtopic && !domain.subtopics.some((s) => s.code === q.subtopic))
    issues.push(`${at} sous-thème ${q.subtopic} absent du domaine ${q.domain}`);
  if (!cert.allowedQuestionTypes.includes(q.body.type)) issues.push(`${at} type ${q.body.type} non autorisé`);
  if (q.body.type === 'mcq_single' || q.body.type === 'mcq_multi') {
    const ids = q.body.options.map((o) => o.id);
    for (const id of Object.keys(q.distractorNotes)) {
      if (!ids.includes(id)) issues.push(`${at} note pour une option inconnue : ${id}`);
    }
  }
  return issues;
}

/** Charge et valide une certification et toute sa banque. Échoue au moindre problème. */
export function loadCertification(code: string, dataDir = DATA_DIR): ContentBundle {
  const certification = parseCertification(readJson(join(dataDir, 'certifications', `${code}.json`)));
  const dir = join(dataDir, 'questions', code);
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

  const questions: Question[] = [];
  const issues: string[] = [];
  const slugs = new Set<string>();
  const stems = new Map<string, string>();

  for (const file of files) {
    const raw = readJson(join(dir, file));
    if (!Array.isArray(raw)) {
      issues.push(`${file} : un tableau de questions est attendu`);
      continue;
    }
    raw.forEach((item, index) => {
      let q: Question;
      try {
        q = parseQuestion(item);
      } catch (err) {
        issues.push(`${file}#${index} : ${(err as Error).message}`);
        return;
      }
      if (slugs.has(q.slug)) issues.push(`${file} : slug en double ${q.slug}`);
      slugs.add(q.slug);
      const stemKey = `${q.body.stem.trim().toLowerCase()}|${q.body.exhibit ?? ''}`;
      const twin = stems.get(stemKey);
      if (twin) issues.push(`${file} : ${q.slug} a le même énoncé que ${twin}`);
      stems.set(stemKey, q.slug);
      issues.push(...checkQuestionAgainstCertification(q, certification));
      questions.push(q);
    });
  }

  if (issues.length) throw new ContentError(`Contenu invalide pour ${code}`, issues);
  return { certification, questions };
}

export interface LabBundle {
  /** Profil de terminal de la certification (modes, prompts, messages, commandes). */
  profile: TerminalProfile;
  labs: Lab[];
}

const PROFILE_FILE = 'profile.json';
/** Sous-dossier des challenges chronométrés, à côté des labs. */
const CHALLENGES_DIR = 'challenges';

/** Certifications qui ont des labs (un dossier `data/labs/<code>/` avec un `profile.json`). */
export function listLabCertificationCodes(dataDir = DATA_DIR): string[] {
  const dir = join(dataDir, 'labs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((code) => existsSync(join(dir, code, PROFILE_FILE)))
    .sort();
}

/** Profil de terminal d'une certification, ou null si elle n'a pas de labs. */
export function loadLabProfile(code: string, dataDir = DATA_DIR): TerminalProfile | null {
  const path = join(dataDir, 'labs', code, PROFILE_FILE);
  return existsSync(path) ? parseTerminalProfile(readJson(path)) : null;
}

/**
 * Vérifie qu'un lab est rangé au bon endroit (certification, domaine, sous-thème, profil),
 * puis le joue : état de départ, solution, variantes et pièges (voir `checkLab`).
 */
export function checkLabAgainstCertification(lab: Lab, cert: CertificationConfig, profile: TerminalProfile): string[] {
  const at = `[${lab.slug}]`;
  const issues: string[] = [];
  if (lab.certification !== cert.code) issues.push(`${at} certification ${lab.certification} au lieu de ${cert.code}`);
  const domain = cert.domains.find((d) => d.code === lab.domain);
  if (!domain) issues.push(`${at} domaine inconnu : ${lab.domain}`);
  else if (!domain.subtopics.some((s) => s.code === lab.subtopic)) issues.push(`${at} sous-thème ${lab.subtopic} absent du domaine ${lab.domain}`);
  if (lab.profile !== profile.id) issues.push(`${at} profil ${lab.profile} au lieu de ${profile.id}`);
  else issues.push(...checkLab(profile, lab).map((i) => `${at} ${i}`));
  return issues;
}

/** Charge, valide et joue tous les labs d'une certification. Échoue au moindre problème. */
export function loadLabs(code: string, dataDir = DATA_DIR): LabBundle {
  const profile = loadLabProfile(code, dataDir);
  if (!profile) throw new ContentError(`Pas de labs pour ${code}`, [`${PROFILE_FILE} manquant`]);
  const certification = parseCertification(readJson(join(dataDir, 'certifications', `${code}.json`)));
  const dir = join(dataDir, 'labs', code);
  const labs: Lab[] = [];
  const issues: string[] = [];
  const slugs = new Set<string>();
  // Les labs à la racine du dossier, les challenges dans `challenges/` : même format, `kind` les distingue.
  const files = (sub: string) => {
    const d = join(dir, sub);
    return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.json') && f !== PROFILE_FILE).sort().map((f) => join(sub, f)) : [];
  };
  for (const file of [...files(''), ...files(CHALLENGES_DIR)]) {
    let lab: Lab;
    try {
      lab = parseLab(readJson(join(dir, file)));
    } catch (err) {
      issues.push(`${file} : ${(err as Error).message}`);
      continue;
    }
    const expected = file.startsWith(`${CHALLENGES_DIR}/`) ? 'challenge' : 'lab';
    if (lab.kind !== expected) issues.push(`${file} : kind ${lab.kind} attendu ${expected}`);
    if (slugs.has(lab.slug)) issues.push(`${file} : slug en double ${lab.slug}`);
    slugs.add(lab.slug);
    issues.push(...checkLabAgainstCertification(lab, certification, profile));
    labs.push(lab);
  }
  if (issues.length) throw new ContentError(`Labs invalides pour ${code}`, issues);
  return { profile, labs };
}

/** Fichier de la série d'examens blancs figés d'une certification. */
export const seriesPath = (code: string, dataDir = DATA_DIR) => join(dataDir, 'exams', `${code}.json`);

/** Ce dont l'assemblage a besoin d'une question de la banque : le slug sert d'identifiant. */
export function poolOf(questions: readonly Question[]): PoolQuestion[] {
  return questions.map((q) => ({ id: q.slug, domain: q.domain, type: q.body.type, difficulty: q.difficulty, subtopic: q.subtopic ?? null }));
}

/**
 * Charge la série figée d'une certification (null si elle n'en a pas) et la contrôle face à sa banque :
 * format officiel, pondérations, aucun doublon ni slug inconnu, plafonds tenus, chaque question servie.
 */
export function loadExamSeries(code: string, dataDir = DATA_DIR): ExamSeries | null {
  const path = seriesPath(code, dataDir);
  if (!existsSync(path)) return null;
  const series = parseExamSeries(readJson(path));
  const { certification, questions } = loadCertification(code, dataDir);
  const issues: string[] = [];
  if (series.certification !== code) issues.push(`certification ${series.certification} au lieu de ${code}`);
  issues.push(...checkSeries(series.exams.map((e) => e.questions), poolOf(questions), certification, series.constraints));
  if (issues.length) throw new ContentError(`Série d'examens invalide pour ${code}`, issues);
  return series;
}
