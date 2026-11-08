#!/usr/bin/env node
/**
 * Contexte d'un lot de génération : pour chaque sous-thème demandé, les questions déjà présentes
 * (slug, type, difficulté, énoncé, bonne réponse), à ne pas dupliquer.
 *
 *   node packages/content/scripts/batch-context.mjs 3.4 [3.5 …] [--cert ccna] [--full]
 *
 * --full affiche l'énoncé entier et l'exhibit (sinon : 220 premiers caractères).
 * Nécessite `pnpm build` (lit les paquets compilés).
 */
import { answerSignature } from '@examforge/core';
import { loadCertification } from '../dist/index.js';

const args = process.argv.slice(2);
const cert = args.includes('--cert') ? args[args.indexOf('--cert') + 1] : 'ccna';
const full = args.includes('--full');
const subtopics = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--cert');
if (!subtopics.length) {
  console.error('Usage : batch-context.mjs <sous-thème>… [--cert ccna] [--full]');
  process.exit(2);
}

const { certification, questions } = loadCertification(cert);
const cut = (s, n) => (full || s.length <= n ? s : `${s.slice(0, n)}…`);

for (const code of subtopics) {
  const domain = certification.domains.find((d) => d.subtopics.some((s) => s.code === code));
  const sub = domain?.subtopics.find((s) => s.code === code);
  if (!sub) {
    console.error(`Sous-thème inconnu : ${code}`);
    process.exit(2);
  }
  const list = questions.filter((q) => q.subtopic === code);
  console.log(`\n## ${code} ${sub.name} (domaine ${domain.code} ${domain.name}) : ${list.length} questions`);
  for (const q of list) {
    console.log(`- ${q.slug} [${q.body.type}, ${q.difficulty}] ${cut(q.body.stem.replace(/\s+/g, ' '), 220)}`);
    if (full && q.body.exhibit) console.log(`    exhibit : ${q.body.exhibit.replace(/\n/g, '\n      ')}`);
    console.log(`    réponse : ${cut(answerSignature(q.body, q.key), 160)}`);
  }
}
