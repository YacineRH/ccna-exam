#!/usr/bin/env node
/**
 * Paires de questions suspectes de toute la banque, pour la relecture.
 *
 *   node packages/content/scripts/near-duplicates.mjs [--cert ccna] [--threshold 0.5] [--json]
 *
 * Par défaut, toutes les paires au-dessus du seuil de suspicion (SUSPECT_THRESHOLD) ; celles qui
 * dépassent le seuil de doublon (DUPLICATE_THRESHOLD) sont marquées « DOUBLON » et font échouer
 * les tests de contenu. Nécessite `pnpm build`.
 */
import { DUPLICATE_THRESHOLD, SUSPECT_THRESHOLD, findNearDuplicates } from '@examforge/core';
import { loadCertification } from '../dist/index.js';

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const cert = opt('--cert') ?? 'ccna';
const threshold = Number(opt('--threshold') ?? SUSPECT_THRESHOLD);

const { questions } = loadCertification(cert);
const pairs = findNearDuplicates(
  questions.map((q) => ({ id: q.slug, body: q.body, key: q.key })),
  { threshold },
);
if (args.includes('--json')) {
  console.log(JSON.stringify(pairs, null, 1));
  process.exit(0);
}
const stem = new Map(questions.map((q) => [q.slug, q.body.stem.replace(/\s+/g, ' ').slice(0, 150)]));
console.log(`${questions.length} questions, ${pairs.length} paires au-dessus de ${threshold} (doublon à partir de ${DUPLICATE_THRESHOLD})`);
for (const p of pairs) {
  const tag = p.score >= DUPLICATE_THRESHOLD ? 'DOUBLON' : 'suspect';
  console.log(`\n${tag} ${p.score} (texte ${p.text}, valeurs ${p.values ?? '-'}, même réponse ${p.sameAnswer ? 'oui' : 'non'})`);
  console.log(`  ${p.a} : ${stem.get(p.a)}`);
  console.log(`  ${p.b} : ${stem.get(p.b)}`);
}
