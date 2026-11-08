import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Le moteur est générique : aucune certification n'est écrite en dur dans le code de core, api, web ou mcp.
 * Tout ce qui est propre à une certification vit dans packages/content/data/. Les tests et les commentaires
 * peuvent citer le CCNA (exemples, cas de régression) ; le code exécuté, jamais.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..');
const SOURCES = ['packages/core/src', 'apps/api/src', 'apps/web/src', 'apps/mcp/src', 'apps/web/index.html'];
const FORBIDDEN = [/ccna/i, /200-301/, /\bcisco\b/i];

function files(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((f) => files(join(path, f)));
}

const isTest = (f: string) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f) || /[\\/](test|tests|__tests__)[\\/]/.test(f);

/** Retire les commentaires (bloc, ligne, HTML, JSX) en gardant les chaînes qui contiennent « // » (URL). */
export function stripComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

describe('généricité du moteur', () => {
  it('retire bien les commentaires et garde le code', () => {
    expect(stripComments("const a = 'ccna'; // ccna")).toBe("const a = 'ccna'; ");
    expect(stripComments('/* ccna */ x')).toBe(' x');
    expect(stripComments("fetch('https://exemple.fr') // commentaire")).toBe("fetch('https://exemple.fr') ");
  });

  const sources = SOURCES.flatMap((s) => files(join(ROOT, s))).filter((f) => /\.(ts|tsx|js|mjs|html|css)$/.test(f) && !isTest(f));

  it('parcourt bien les sources', () => {
    expect(sources.length).toBeGreaterThan(50);
  });

  it('ne cite aucune certification dans le code de core, api, web et mcp (hors tests et commentaires)', () => {
    const hits: string[] = [];
    for (const f of sources) {
      const lines = stripComments(readFileSync(f, 'utf8')).split('\n');
      lines.forEach((line, i) => {
        if (FORBIDDEN.some((re) => re.test(line))) hits.push(`${relative(ROOT, f)}:${i + 1} ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
