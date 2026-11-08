#!/usr/bin/env node
/**
 * Contrôle d'un lab ou d'un challenge avant de le verser dans data/labs/ : schéma, rangement, puis
 * le simulateur joue l'état de départ, la solution, les variantes et les pièges (checkLab).
 *
 *   node packages/content/scripts/check-lab.mjs <lab.json> [--cert ccna]
 *
 * Nécessite `pnpm build`.
 */
import { readFileSync } from 'node:fs';
import { parseCertification, parseLab } from '@examforge/core';
import { DATA_DIR, checkLabAgainstCertification, loadLabProfile } from '../dist/index.js';
import { join } from 'node:path';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const cert = args.includes('--cert') ? args[args.indexOf('--cert') + 1] : 'ccna';
if (!file) {
  console.error('Usage : check-lab.mjs <lab.json> [--cert ccna]');
  process.exit(2);
}
let lab;
try {
  lab = parseLab(JSON.parse(readFileSync(file, 'utf8')));
} catch (e) {
  console.error(`Schéma invalide :\n${e.issues?.map((i) => `- ${i.path.join('.')} : ${i.message}`).join('\n') ?? e.message}`);
  process.exit(1);
}
const certification = parseCertification(JSON.parse(readFileSync(join(DATA_DIR, 'certifications', `${cert}.json`), 'utf8')));
const profile = loadLabProfile(cert);
const issues = checkLabAgainstCertification(lab, certification, profile);
if (issues.length) {
  console.log(`ERREURS (${issues.length}) :\n- ${issues.join('\n- ')}`);
  process.exit(1);
}
console.log(`${lab.slug} (${lab.kind}) : OK, joué dans le simulateur sans erreur.`);
