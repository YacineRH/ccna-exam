#!/usr/bin/env node
/**
 * Tirage déterministe de l'échantillon de contrôle (troisième passe, docs/generation/consigne-echantillon.md) :
 * 5 % des questions publiées de chaque lot, au moins une par lot.
 *
 *   node packages/content/scripts/sample-batch.mjs --cert security-plus [--seed 20261108] [--rate 0.05] [--json]
 *
 * Un lot = un fichier de data/questions/<cert>/ nommé « <identifiant du lot>-<sous-thèmes>.json » (s01-1.1-….json) ;
 * les fichiers sans préfixe de lot (banque d'origine) sont ignorés. Même banque et même seed : même échantillon.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRng } from '@examforge/core';
import { DATA_DIR } from '../dist/index.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const cert = opt('--cert', 'ccna');
const seed = Number(opt('--seed', 20261108));
const rate = Number(opt('--rate', 0.05));

const dir = join(DATA_DIR, 'questions', cert);
const lots = readdirSync(dir)
  .filter((f) => /^s\d+-.+\.json$/.test(f))
  .sort()
  .map((f) => ({ lot: f.split('-')[0], file: f, slugs: JSON.parse(readFileSync(join(dir, f), 'utf8')).map((q) => q.slug).sort() }));

const rng = createRng(seed);
const sample = lots.map(({ lot, file, slugs }) => {
  const n = Math.max(1, Math.ceil(slugs.length * rate));
  const pool = [...slugs];
  const picked = [];
  while (picked.length < n) picked.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return { lot, file, published: slugs.length, sampled: picked.sort() };
});

if (args.includes('--json')) {
  console.log(JSON.stringify({ certification: cert, seed, rate, lots: sample }, null, 1));
} else {
  const total = sample.reduce((s, l) => s + l.sampled.length, 0);
  console.log(`${total} questions tirées sur ${lots.reduce((s, l) => s + l.slugs.length, 0)} (seed ${seed}, ${rate * 100} %)`);
  for (const l of sample) console.log(`${l.lot} (${l.file}) : ${l.sampled.length}/${l.published} — ${l.sampled.join(', ')}`);
}
