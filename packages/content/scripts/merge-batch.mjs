#!/usr/bin/env node
/**
 * Publie un lot relu dans la banque : contrôle (check-batch.mjs), puis copie dans
 * data/questions/<cert>/<nom>.json au format des autres fichiers.
 *
 *   node packages/content/scripts/merge-batch.mjs <lot relu.json> <nom du fichier> [--subtopics 1.2,1.12] [--cert ccna]
 *
 * Refuse d'écraser un fichier existant. Un lot qui n'a pas été relu ne doit jamais passer par ici.
 * Nécessite `pnpm build`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from '../dist/index.js';

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const [source, name] = args.filter((a, i) => !a.startsWith('--') && !['--cert', '--subtopics'].includes(args[i - 1]));
if (!source || !name) {
  console.error('Usage : merge-batch.mjs <lot relu.json> <nom du fichier> [--subtopics …] [--cert ccna]');
  process.exit(2);
}
const cert = opt('--cert') ?? 'ccna';
const target = join(DATA_DIR, 'questions', cert, name.endsWith('.json') ? name : `${name}.json`);
if (existsSync(target)) {
  console.error(`${target} existe déjà.`);
  process.exit(1);
}
const check = join(dirname(fileURLToPath(import.meta.url)), 'check-batch.mjs');
const extra = [...(opt('--subtopics') ? ['--subtopics', opt('--subtopics')] : []), '--cert', cert];
try {
  execFileSync(process.execPath, [check, source, ...extra], { stdio: 'inherit' });
} catch {
  console.error('Lot refusé par le contrôle : rien n’a été copié.');
  process.exit(1);
}
const questions = JSON.parse(readFileSync(source, 'utf8'));
writeFileSync(target, `${JSON.stringify(questions, null, 2)}\n`);
console.log(`${questions.length} questions publiées dans ${target}`);
