// Budget de taille du bundle initial du front : ce que le navigateur charge avant le premier écran
// (script d'entrée, modules préchargés, feuille de style), mesuré compressé (gzip), après `pnpm build`.
// Usage : node scripts/check-bundle.mjs [dossier dist]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET = { js: 75 * 1024, css: 10 * 1024 };
const dist = process.argv[2] ?? 'apps/web/dist';
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(js|css))"/g)].map((m) => ({ path: m[1], kind: m[2] }));
if (!assets.some((a) => a.kind === 'js')) {
  console.error(`Aucun script trouvé dans ${dist}/index.html : lancez pnpm build.`);
  process.exit(1);
}
const total = { js: 0, css: 0 };
for (const a of assets) {
  const size = gzipSync(readFileSync(join(dist, a.path))).length;
  total[a.kind] += size;
  console.log(`${a.path.padEnd(40)} ${(size / 1024).toFixed(1).padStart(7)} Ko (gzip)`);
}
let ok = true;
for (const kind of ['js', 'css']) {
  const pass = total[kind] <= BUDGET[kind];
  ok &&= pass;
  console.log(`${pass ? 'OK ' : 'DÉPASSÉ'} ${kind.toUpperCase()} initial : ${(total[kind] / 1024).toFixed(1)} Ko / budget ${(BUDGET[kind] / 1024).toFixed(0)} Ko`);
}
process.exit(ok ? 0 : 1);
