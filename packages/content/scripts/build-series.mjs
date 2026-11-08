#!/usr/bin/env node
/**
 * Assemble la série d'examens blancs figés d'une certification et l'écrit dans data/exams/<code>.json.
 *
 *   node packages/content/scripts/build-series.mjs [--cert ccna] [--seed 200301] [--exams 100]
 *          [--max-uses 8] [--max-overlap 12] [--report rapport.md] [--check]
 *
 * Sans option, reprend le seed et les plafonds du fichier existant. --check n'écrit rien : il vérifie que le
 * fichier est exactement ce que l'assembleur produit avec la banque actuelle (code de sortie 1 sinon).
 * --report écrit un rapport en Markdown (réutilisation, recouvrements, couverture). Nécessite `pnpm build`.
 *
 * Un examen déjà passé ne change jamais en base : l'import le fige (voir docs/DEPLOIEMENT.md).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { assembleSeries } from '@examforge/core';
import { loadCertification, poolOf, seriesPath } from '../dist/index.js';

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const code = opt('--cert') ?? 'ccna';
const path = seriesPath(code);
const previous = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;

const seed = Number(opt('--seed') ?? previous?.seed ?? 200301);
const examCount = Number(opt('--exams') ?? previous?.exams.length ?? 100);
const maxUses = Number(opt('--max-uses') ?? previous?.constraints.maxUses ?? 8);
const maxOverlap = Number(opt('--max-overlap') ?? previous?.constraints.maxOverlap ?? 12);

const { certification, questions } = loadCertification(code);
const started = Date.now();
const { exams, report } = assembleSeries(poolOf(questions), certification, { seed, examCount, maxUses, maxOverlap });
const ms = Date.now() - started;

const series = {
  certification: code,
  seed,
  constraints: { maxUses, maxOverlap },
  exams: exams.map((ids, i) => ({ number: i + 1, title: `Examen blanc n° ${i + 1}`, questions: ids })),
};

// Un examen par bloc, une question par ligne : les différences restent lisibles dans git.
const text = `${JSON.stringify(series, null, 2)}\n`;

if (args.includes('--check')) {
  const same = previous && `${JSON.stringify(previous, null, 2)}\n` === text;
  console.log(same ? `${path} : à jour.` : `${path} : diffère de ce que produit l'assembleur. Relancez build-series.mjs.`);
  process.exit(same ? 0 : 1);
}

mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, text);

const pct = (n, total) => `${((100 * n) / total).toFixed(1).replace('.', ',')} %`;
const q = report.questionCount;
const lines = [
  `# Série d'examens blancs ${certification.name} (${certification.examCode})`,
  '',
  `${report.examCount} examens de ${q} questions, seed ${seed}, banque de ${report.poolSize} questions, assemblés en ${ms} ms.`,
  '',
  '| Mesure | Valeur | Plafond |',
  '| --- | --- | --- |',
  `| Examens par question | min ${report.uses.min}, moyenne ${String(report.uses.mean).replace('.', ',')}, max ${report.uses.max} | ${maxUses} |`,
  `| Questions jamais servies | ${report.uses.unused.length} | 0 |`,
  `| Questions communes à deux examens | moyenne ${String(report.overlap.mean).replace('.', ',')} (${pct(report.overlap.mean, q)}), max ${report.overlap.max} (${pct(report.overlap.max, q)}, examens ${report.overlap.maxPair?.join(' et ')}) | ${maxOverlap} (${pct(maxOverlap, q)}) |`,
  `| Sous-thèmes couverts par examen | min ${report.subtopics.minCovered}, moyenne ${String(report.subtopics.meanCovered).replace('.', ',')} sur ${report.subtopics.total} | |`,
  ...['easy', 'medium', 'hard'].map((d) => {
    const r = report.difficulty[d];
    const label = { easy: 'faciles', medium: 'moyennes', hard: 'difficiles' }[d];
    return `| Questions ${label} par examen | min ${r.min}, moyenne ${String(r.mean).replace('.', ',')}, max ${r.max} | |`;
  }),
  '',
  '**Réutilisation** (nombre de questions par nombre d\'examens qui les contiennent) : ' +
    Object.entries(report.uses.histogram).map(([k, v]) => `${k} examens : ${v}`).join(', ') + '.',
  '',
  '**Recouvrements** (nombre de paires d\'examens par nombre de questions communes) : ' +
    Object.entries(report.overlap.histogram).map(([k, v]) => `${k} : ${v}`).join(', ') + '.',
];
const summary = lines.join('\n');
if (opt('--report')) writeFileSync(opt('--report'), `${summary}\n`);
console.log(summary);
console.log(`\nÉcrit : ${path}`);
