import type { AnswerKey, QuestionBody } from './question.js';

/**
 * Détection des quasi-doublons, au-delà de l'empreinte exacte de l'énoncé.
 *
 * Deux questions sont comparées sur trois signaux, sans rien connaître de la certification :
 * - le texte : énoncé et exhibit, normalisés (casse, accents, ponctuation, mots vides retirés),
 *   réduits à leurs racines ;
 * - les valeurs : adresses IPv4 et IPv6 (avec leur préfixe), adresses MAC et nombres d'au moins
 *   deux chiffres, qui font d'un même gabarit deux exercices différents ;
 * - la bonne réponse, normalisée (texte des options justes, valeurs attendues, commandes).
 *
 * Le score combine les trois (voir `compareFingerprints`) : deux énoncés proches sur des valeurs
 * différentes restent deux exercices, deux énoncés proches qui portent les mêmes valeurs et la
 * même réponse sont un doublon.
 */

/**
 * Clé d'unicité exacte d'une question : énoncé, exhibit et textes des choix, normalisés.
 * Deux questions qui ne diffèrent que par la casse, les espaces ou l'ordre des options ont la même.
 * L'API en stocke l'empreinte SHA-256 (index unique par certification).
 */
export function contentKey(body: QuestionBody): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const parts: string[] = [body.type, norm(body.stem), norm(body.exhibit ?? '')];
  if (body.type === 'mcq_single' || body.type === 'mcq_multi') parts.push(...body.options.map((o) => norm(o.text)).sort());
  if (body.type === 'ordering') parts.push(...body.items.map((o) => norm(o.text)).sort());
  if (body.type === 'matching') parts.push(...[...body.left, ...body.right].map((o) => norm(o.text)).sort());
  if (body.type === 'fill_blank') parts.push(...body.fields.map((f) => norm(f.label)).sort());
  return parts.join('\u241f');
}

export interface SimilarityQuestion {
  id: string;
  body: QuestionBody;
  key: AnswerKey;
}

export interface QuestionFingerprint {
  id: string;
  type: QuestionBody['type'];
  /** Racines des mots de l'énoncé et de l'exhibit (5 premières lettres, accents et mots vides retirés). */
  stems: Set<string>;
  values: Set<string>;
  answer: string;
}

export interface SimilarityScore {
  /** Score combiné entre 0 et 1. */
  score: number;
  /** Proximité du texte (énoncé et exhibit), entre 0 et 1. */
  text: number;
  /** Part des valeurs communes, ou null si aucune des deux questions n'en porte. */
  values: number | null;
  sameAnswer: boolean;
}

export interface SimilarPair extends SimilarityScore {
  a: string;
  b: string;
}

/**
 * Seuil au-delà duquel deux questions sont un doublon à éliminer (les tests de contenu l'exigent).
 * Calibré dans `similarity.test.ts` : une reformulation des mêmes valeurs et de la même réponse le dépasse,
 * un même gabarit sur d'autres valeurs reste en dessous.
 */
export const DUPLICATE_THRESHOLD = 0.7;
/** Seuil de la liste des paires suspectes, à relire sans être bloquantes. */
export const SUSPECT_THRESHOLD = 0.5;

/** Mots sans valeur discriminante, en français et en anglais (les énoncés citent des sorties IOS). */
const STOPWORDS = new Set(
  (
    'a ai au aux avec ce ces cet cette d dans de des du elle en est et etre il ils l la le les leur leurs lui ' +
    'ma mais me meme mes n ne ni nos notre on ou par pas pour qu que quel quelle quelles quels qui sa sans se ses ' +
    'si son sont sur ta te tes un une vos votre y deux trois quatre cinq laquelle lequel lesquels lesquelles dont ' +
    'doit peut faut fait cas chaque tout tous toute toutes autre autres entre afin ainsi alors apres avant ' +
    'reportez vous exhibit suivant suivante suivants suivantes ci dessous dessus quelle quel quels quelles ' +
    'the of to and or in on is are for with by from at as an be this that which what'
  ).split(/\s+/),
);

const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/g;
const IPV6 = /\b(?:[0-9a-f]{1,4}:){2,7}(?::?[0-9a-f]{0,4})*(?:\/\d{1,3})?/gi;
const MAC = /\b(?:[0-9a-f]{4}\.){2}[0-9a-f]{4}\b|\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi;
const NUMBER = /\b\d{2,}\b/g;
/** Heures des sorties IOS (00:12:40) : du bruit, ni adresse ni valeur. */
const TIME = /\b\d{1,2}:\d{2}:\d{2}\b/g;

/** Valeurs portées par un texte : adresses, préfixes, MAC, nombres d'au moins deux chiffres. */
export function extractValues(text: string): Set<string> {
  const values = new Set<string>();
  let rest = text.toLowerCase().replace(TIME, ' ');
  for (const re of [IPV4, MAC, IPV6]) {
    rest = rest.replace(re, (m) => {
      // Une heure de sortie IOS (00:12:40) n'est pas une adresse IPv6.
      if (re === IPV6 && !m.includes('::') && (m.match(/:/g) ?? []).length < 4) return m;
      values.add(m.replace(/:+$/, ''));
      return ' ';
    });
  }
  for (const m of rest.match(NUMBER) ?? []) values.add(String(Number(m)));
  return values;
}

/** Mots normalisés d'un texte, valeurs et mots vides retirés. */
export function contentWords(text: string): string[] {
  const cleaned = stripAccents(text.toLowerCase())
    .replace(IPV4, ' ')
    .replace(MAC, ' ')
    .replace(/[^a-z0-9-]+/g, ' ');
  return cleaned
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ''))
    .filter((w) => w.length > 1 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

const normAnswer = (s: string) => stripAccents(s.toLowerCase()).replace(/\s+/g, ' ').trim();

/** La bonne réponse sous une forme comparable, quel que soit le type de question. */
export function answerSignature(body: QuestionBody, key: AnswerKey): string {
  switch (key.type) {
    case 'mcq_single': {
      const options = body.type === 'mcq_single' ? body.options : [];
      return normAnswer(options.find((o) => o.id === key.correct)?.text ?? key.correct);
    }
    case 'mcq_multi': {
      const options = body.type === 'mcq_multi' ? body.options : [];
      return key.correct
        .map((id) => normAnswer(options.find((o) => o.id === id)?.text ?? id))
        .sort()
        .join(' | ');
    }
    case 'fill_blank':
      return Object.keys(key.fields)
        .sort()
        .map((id) => normAnswer(key.fields[id]?.accepted[0] ?? ''))
        .join(' | ');
    case 'cli':
      return key.commands.map((c) => normAnswer(c[0] ?? '')).join(' | ');
    case 'ordering': {
      const items = body.type === 'ordering' ? body.items : [];
      return key.order.map((id) => normAnswer(items.find((i) => i.id === id)?.text ?? id)).join(' > ');
    }
    case 'matching': {
      const left = body.type === 'matching' ? body.left : [];
      const right = body.type === 'matching' ? body.right : [];
      return Object.entries(key.pairs)
        .map(([l, r]) => `${normAnswer(left.find((i) => i.id === l)?.text ?? l)} = ${normAnswer(right.find((i) => i.id === r)?.text ?? r)}`)
        .sort()
        .join(' | ');
    }
  }
}

/** Longueur des racines : « adresse » et « adresses », « configurer » et « configuration » se rejoignent. */
const STEM_LENGTH = 5;

export function fingerprintQuestion(q: SimilarityQuestion): QuestionFingerprint {
  const text = `${q.body.stem}\n${q.body.exhibit ?? ''}`;
  return {
    id: q.id,
    type: q.body.type,
    stems: new Set(contentWords(text).map((w) => w.slice(0, STEM_LENGTH))),
    values: extractValues(text),
    answer: answerSignature(q.body, q.key),
  };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) inter++;
  return inter / small.size;
}

/**
 * Compare deux empreintes.
 *
 * - texte = moyenne du Jaccard et du coefficient de recouvrement des racines (une reformulation garde
 *   les mêmes termes techniques dans un autre ordre ; le recouvrement attrape un énoncé contenu dans un autre,
 *   le Jaccard l'empêche de suffire) ;
 * - valeurs = Jaccard des valeurs, ou null si aucune des deux n'en porte ;
 * - score = texte × réponse × valeurs, où réponse vaut 1 si la bonne réponse est la même, 0,6 sinon, et
 *   valeurs vaut 0,4 + 0,6 × Jaccard des valeurs (1 si aucune question n'en porte).
 *
 * Un même gabarit sur d'autres valeurs (autre exercice) tombe donc bas, une même question reformulée
 * (mêmes termes, mêmes valeurs, même réponse) reste haut.
 */
export function compareFingerprints(a: QuestionFingerprint, b: QuestionFingerprint): SimilarityScore {
  const text = (jaccard(a.stems, b.stems) + overlap(a.stems, b.stems)) / 2;
  const values = a.values.size === 0 && b.values.size === 0 ? null : jaccard(a.values, b.values);
  const sameAnswer = a.answer !== '' && a.answer === b.answer;
  const score = text * (sameAnswer ? 1 : 0.6) * (values === null ? 1 : 0.4 + 0.6 * values);
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return { score: round(score), text: round(text), values: values === null ? null : round(values), sameAnswer };
}

export function compareQuestions(a: SimilarityQuestion, b: SimilarityQuestion): SimilarityScore {
  return compareFingerprints(fingerprintQuestion(a), fingerprintQuestion(b));
}

export interface NearDuplicateOptions {
  /** Score minimal d'une paire retenue. Par défaut `SUSPECT_THRESHOLD`. */
  threshold?: number;
  /** Ne compare que les paires où au moins une question est dans cet ensemble (un lot face à la banque). */
  only?: ReadonlySet<string>;
}

/**
 * Paires de questions dont le score atteint le seuil, de la plus proche à la moins proche.
 * Toutes les paires sont comparées (une banque de quelques milliers de questions se traite en une seconde) ;
 * un filtre rapide sur les mots communs écarte d'abord les paires sans rapport.
 */
export function findNearDuplicates(
  questions: readonly SimilarityQuestion[],
  options: NearDuplicateOptions = {},
): SimilarPair[] {
  const threshold = options.threshold ?? SUSPECT_THRESHOLD;
  const prints = questions.map(fingerprintQuestion);
  const pairs: SimilarPair[] = [];
  for (let i = 0; i < prints.length; i++) {
    const a = prints[i] as QuestionFingerprint;
    for (let j = i + 1; j < prints.length; j++) {
      const b = prints[j] as QuestionFingerprint;
      if (options.only && !options.only.has(a.id) && !options.only.has(b.id)) continue;
      // score ≤ texte ≤ recouvrement des racines : en dessous du seuil, inutile d'aller plus loin.
      if (overlap(a.stems, b.stems) < threshold) continue;
      const s = compareFingerprints(a, b);
      if (s.score >= threshold) pairs.push({ a: a.id, b: b.id, ...s });
    }
  }
  return pairs.sort((x, y) => y.score - x.score || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
}
