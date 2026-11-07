#!/usr/bin/env node
/**
 * Contrôle automatique d'un lot de questions avant sa relecture, puis avant sa publication.
 *
 *   node packages/content/scripts/check-batch.mjs <lot.json> [--subtopics 1.2,1.12] [--cert ccna]
 *
 * Erreurs (code de sortie 1) : schéma et cohérence de la correction, rangement (domaine, sous-thème,
 * type autorisé), source `ai`, slug (format, unicité face à la banque et au lot), référence, note pour
 * chaque distracteur, bonne réponse qui obtient tous les points, doublon exact, quasi-doublon au-delà de
 * DUPLICATE_THRESHOLD (face à la banque et dans le lot), QCM multiple qui n'annonce pas le nombre de réponses.
 * Avertissements : paires suspectes (≥ SUSPECT_THRESHOLD), mots CLI sans abréviation reconnue, bonne réponse
 * nettement plus longue que les distracteurs, explication courte, nombre d'options inhabituel.
 *
 * Un lot déjà fusionné dans data/ est comparé à la banque sans lui-même (par slug).
 * Nécessite `pnpm build` (lit les paquets compilés).
 */
import { readFileSync } from 'node:fs';
import {
  CLI_KEYWORDS,
  DUPLICATE_THRESHOLD,
  SUSPECT_THRESHOLD,
  contentKey,
  findNearDuplicates,
  grade,
  normalizeIpv4,
  parseQuestion,
} from '@examforge/core';
import { checkQuestionAgainstCertification, loadCertification } from '../dist/index.js';

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const file = args.find((a, i) => !a.startsWith('--') && !['--cert', '--subtopics'].includes(args[i - 1]));
if (!file) {
  console.error('Usage : check-batch.mjs <lot.json> [--subtopics 1.2,1.12] [--cert ccna]');
  process.exit(2);
}
const certCode = opt('--cert') ?? 'ccna';
const allowedSubtopics = opt('--subtopics')?.split(',').map((s) => s.trim()).filter(Boolean);

const errors = [];
const warnings = [];
const err = (slug, msg) => errors.push(`[${slug}] ${msg}`);
const warn = (slug, msg) => warnings.push(`[${slug}] ${msg}`);

let raw;
try {
  raw = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`JSON illisible : ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(raw)) {
  console.error('Un tableau de questions est attendu.');
  process.exit(1);
}

const { certification, questions: bankAll } = loadCertification(certCode);
const batchSlugs = new Set(raw.map((q) => q?.slug).filter(Boolean));
const bank = bankAll.filter((q) => !batchSlugs.has(q.slug));
const bankSlugs = new Set(bank.map((q) => q.slug));
const bankKeys = new Map(bank.map((q) => [contentKey(q.body), q.slug]));

function perfectResponse(key) {
  switch (key.type) {
    case 'mcq_single':
      return { type: 'mcq_single', choice: key.correct };
    case 'mcq_multi':
      return { type: 'mcq_multi', choices: key.correct };
    case 'fill_blank':
      return { type: 'fill_blank', fields: Object.fromEntries(Object.entries(key.fields).map(([id, f]) => [id, f.accepted[0]])) };
    case 'cli':
      return { type: 'cli', lines: key.commands.map((c) => c[0]) };
    case 'ordering':
      return { type: 'ordering', order: key.order };
    case 'matching':
      return { type: 'matching', pairs: key.pairs };
  }
}

const parsed = [];
const seenSlugs = new Set();
const seenKeys = new Map();
const unknownCliWords = new Map();
const keywords = new Set(CLI_KEYWORDS);

raw.forEach((item, index) => {
  const slug = item?.slug ?? `#${index}`;
  let q;
  try {
    q = parseQuestion(item);
  } catch (e) {
    const issues = e.issues?.map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`) ?? [e.message];
    for (const i of issues) err(slug, i);
    return;
  }
  parsed.push(q);
  for (const i of checkQuestionAgainstCertification(q, certification)) err(slug, i.replace(/^\[[^\]]+\] /, ''));

  if (q.source !== 'ai') err(slug, 'source "ai" attendue');
  if (!q.subtopic) err(slug, 'sous-thème manquant');
  else if (allowedSubtopics && !allowedSubtopics.includes(q.subtopic)) err(slug, `sous-thème ${q.subtopic} hors du lot (${allowedSubtopics.join(', ')})`);
  if (q.subtopic && !q.slug.startsWith(`${certCode}-${q.subtopic}-`)) err(slug, `le slug doit commencer par ${certCode}-${q.subtopic}-`);
  if (bankSlugs.has(q.slug)) err(slug, 'slug déjà présent dans la banque');
  if (seenSlugs.has(q.slug)) err(slug, 'slug en double dans le lot');
  seenSlugs.add(q.slug);
  if (!q.reference?.trim()) err(slug, 'référence manquante (RFC, norme IEEE ou documentation Cisco)');
  if (q.explanation.length < 150) warn(slug, `explication courte (${q.explanation.length} caractères)`);

  const key = contentKey(q.body);
  if (bankKeys.has(key)) err(slug, `même énoncé et mêmes choix que ${bankKeys.get(key)}`);
  if (seenKeys.has(key)) err(slug, `même énoncé et mêmes choix que ${seenKeys.get(key)} (dans le lot)`);
  seenKeys.set(key, q.slug);

  const result = grade(q.key, perfectResponse(q.key));
  if (!result.correct) err(slug, 'la bonne réponse n\'obtient pas tous les points');

  const body = q.body;
  if (body.type === 'mcq_single' || body.type === 'mcq_multi') {
    const correct = q.key.type === 'mcq_single' ? [q.key.correct] : q.key.correct;
    for (const o of body.options) {
      if (!correct.includes(o.id) && !q.distractorNotes[o.id]?.trim()) err(slug, `pas de note pour le distracteur ${o.id}`);
      if (correct.includes(o.id) && q.distractorNotes[o.id]) err(slug, `note de distracteur sur une bonne réponse (${o.id})`);
    }
    if (body.type === 'mcq_single' && body.options.length !== 4) warn(slug, `${body.options.length} options (4 attendues en QCM simple)`);
    if (body.type === 'mcq_multi') {
      if (body.options.length < 5) warn(slug, `${body.options.length} options (5 ou 6 attendues en QCM multiple)`);
      const words = { 2: 'deux', 3: 'trois', 4: 'quatre' };
      const n = body.selectCount;
      if (!new RegExp(`\\b(${words[n] ?? n}|${n})\\b`, 'i').test(body.stem)) err(slug, `l'énoncé doit annoncer le nombre de réponses (${words[n] ?? n})`);
    }
    if (body.type === 'mcq_single') {
      const good = body.options.find((o) => o.id === correct[0])?.text.length ?? 0;
      const others = body.options.filter((o) => o.id !== correct[0]).map((o) => o.text.length);
      const mean = others.reduce((s, n) => s + n, 0) / Math.max(1, others.length);
      if (good > 1.6 * mean && good - mean > 25) warn(slug, `bonne réponse nettement plus longue que les distracteurs (${good} contre ${Math.round(mean)} caractères)`);
    }
  }
  if (body.type === 'matching' && q.key.type === 'matching') {
    const used = new Set(Object.values(q.key.pairs));
    const rightIds = body.right.map((r) => r.id);
    for (const r of body.right) if (!used.has(r.id) && !q.distractorNotes[r.id]?.trim()) err(slug, `pas de note pour le leurre ${r.id}`);
    for (const id of Object.keys(q.distractorNotes)) if (!rightIds.includes(id)) err(slug, `note pour un élément inconnu : ${id}`);
    if (body.left.length < 3) warn(slug, `${body.left.length} éléments à associer (3 au moins conseillés)`);
  }
  if (body.type === 'ordering' && body.items.length < 4) warn(slug, `${body.items.length} éléments à ordonner (4 au moins conseillés)`);
  if (q.key.type === 'fill_blank') {
    for (const [id, f] of Object.entries(q.key.fields)) {
      for (const a of f.accepted) {
        if (f.normalize === 'ipv4' && normalizeIpv4(a) === null) err(slug, `champ ${id} : « ${a} » n'est pas une adresse IPv4`);
        if (f.normalize === 'int' && !/^-?\d+$/.test(a.replace(/[\s  ]/g, ''))) err(slug, `champ ${id} : « ${a} » n'est pas un entier`);
      }
    }
  }
  if (q.key.type === 'cli') {
    for (const forms of q.key.commands) {
      for (const form of forms) {
        for (const w of form.toLowerCase().split(/\s+/)) {
          if (/^[a-z][a-z-]*$/.test(w) && !keywords.has(w)) unknownCliWords.set(w, (unknownCliWords.get(w) ?? 0) + 1);
        }
      }
    }
  }
});

// Quasi-doublons : le lot face à la banque, et dans le lot.
const toSim = (q) => ({ id: q.slug, body: q.body, key: q.key });
const pairs = findNearDuplicates([...bank, ...parsed].map(toSim), { only: new Set(parsed.map((q) => q.slug)) });
const stemOf = new Map([...bank, ...parsed].map((q) => [q.slug, q.body.stem.replace(/\s+/g, ' ').slice(0, 140)]));
for (const p of pairs) {
  const line = `${p.a} ~ ${p.b} : score ${p.score} (texte ${p.text}, valeurs ${p.values ?? '-'}, même réponse ${p.sameAnswer ? 'oui' : 'non'})\n      « ${stemOf.get(p.a)} »\n      « ${stemOf.get(p.b)} »`;
  if (p.score >= DUPLICATE_THRESHOLD) errors.push(`[quasi-doublon] ${line}`);
  else if (p.score >= SUSPECT_THRESHOLD) warnings.push(`[suspect] ${line}`);
}
if (unknownCliWords.size) {
  warnings.push(
    `[cli] mots sans abréviation reconnue (à saisir en entier) : ${[...unknownCliWords.keys()].sort().join(', ')}`,
  );
}

const tally = (f) => parsed.reduce((m, q) => ((m[f(q)] = (m[f(q)] ?? 0) + 1), m), {});
console.log(`${file} : ${raw.length} questions, ${parsed.length} lisibles`);
console.log('  sous-thèmes :', JSON.stringify(tally((q) => q.subtopic)));
console.log('  types       :', JSON.stringify(tally((q) => q.body.type)));
console.log('  difficultés :', JSON.stringify(tally((q) => q.difficulty)));
if (warnings.length) console.log(`\nAvertissements (${warnings.length}) :\n- ${warnings.join('\n- ')}`);
if (errors.length) {
  console.log(`\nERREURS (${errors.length}) :\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log('\nOK : aucune erreur.');
