/**
 * Lecture des syntaxes de commandes du profil : `ip route <ipv4> <ipv4-mask> {<ipv4>|<interface>} [<1-255>]`
 * devient la liste de ses formes linéaires (une par combinaison d'options et d'alternatives).
 *
 * `[* [a] [b] [c] *]` : groupe d'options en ordre libre. Chaque option peut être donnée au plus une fois,
 * dans n'importe quel ordre ; la forme canonique les range dans l'ordre de la syntaxe (`groupOrder`).
 * Exemple : `datetime [* [msec] [localtime] [show-timezone] [year] *]` accepte `datetime localtime msec`.
 */

export const PARAM_TYPES = [
  'ipv4',
  'ipv4-mask',
  'wildcard',
  'ipv6',
  'ipv6-prefix',
  'prefix-length',
  'word',
  'line',
  'number',
  'interface',
  'interface-range',
  'vlan-list',
  'port',
  'mac',
  'area',
] as const;
export type ParamType = (typeof PARAM_TYPES)[number];

export type SyntaxElem =
  | {
      kind: 'kw';
      word: string;
      /** Dans un groupe en ordre libre : identifiant du groupe et rang de l'option dans la syntaxe. */
      group?: number;
      groupOrder?: number;
    }
  | { kind: 'param'; type: ParamType; label: string; min?: number; max?: number; table?: string };

type Node = SyntaxElem | { kind: 'opt'; alts: Node[][] } | { kind: 'alt'; alts: Node[][] } | { kind: 'free'; items: Node[][]; id: number };

/** Toutes les suites ordonnées de parties distinctes d'une liste (sous-ensembles, dans tous les ordres). */
function arrangements<T>(items: readonly T[]): T[][] {
  const out: T[][] = [[]];
  const rec = (prefix: T[], rest: readonly T[]) => {
    rest.forEach((item, i) => {
      const next = [...prefix, item];
      out.push(next);
      rec(next, [...rest.slice(0, i), ...rest.slice(i + 1)]);
    });
  };
  rec([], items);
  return out;
}

function parseParam(raw: string): SyntaxElem {
  const inner = raw.slice(1, -1);
  // Bornes signées permises : `<-23-23>` (décalage horaire).
  const range = /^(-?\d+)-(-?\d+)$/.exec(inner);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    if (min > max) throw new Error(`borne invalide : ${raw}`);
    return { kind: 'param', type: 'number', label: raw, min, max };
  }
  const table = /^port:([a-z0-9-]+)$/.exec(inner);
  if (table) return { kind: 'param', type: 'port', label: raw, table: table[1] as string };
  if (!(PARAM_TYPES as readonly string[]).includes(inner) || inner === 'number') throw new Error(`paramètre inconnu : ${raw}`);
  return { kind: 'param', type: inner as ParamType, label: raw };
}

/**
 * Forme canonique d'une suite de mots reconnue : dans chaque groupe en ordre libre, les options reprennent
 * l'ordre de la syntaxe (IOS affiche `datetime msec localtime`, quel que soit l'ordre saisi).
 */
export function canonicalOrder(elems: readonly SyntaxElem[], words: readonly string[]): string[] {
  const out = [...words];
  let i = 0;
  while (i < elems.length) {
    const e = elems[i] as SyntaxElem;
    if (e.kind !== 'kw' || e.group === undefined) {
      i++;
      continue;
    }
    let j = i;
    while (j < elems.length && (elems[j] as SyntaxElem).kind === 'kw' && (elems[j] as { group?: number }).group === e.group) j++;
    const run = elems.slice(i, j).map((x, k) => ({ order: (x as { groupOrder?: number }).groupOrder ?? 0, k, word: words[i + k] as string }));
    run.sort((a, b) => a.order - b.order || a.k - b.k).forEach((r, k) => (out[i + k] = r.word));
    i = j;
  }
  return out;
}

/** Formes linéaires d'une syntaxe. Lève une erreur lisible si la syntaxe est mal formée. */
export function expandSyntax(syntax: string): SyntaxElem[][] {
  const tokens = syntax.match(/\[\*|\*\]|\[|\]|\{|\}|\||<[^>\s]+>|[^\s[\]{}|<>]+/g) ?? [];
  let i = 0;
  let groups = 0;

  const parseSeq = (): Node[] => {
    const seq: Node[] = [];
    while (i < tokens.length) {
      const t = tokens[i] as string;
      if (t === ']' || t === '}' || t === '|' || t === '*]') break;
      i++;
      if (t === '[*') {
        // Groupe en ordre libre : une suite d'options `[mot]`, sans paramètre (les valeurs `{$n}` garderaient leur rang).
        const inner = parseSeq();
        if (tokens[i++] !== '*]') throw new Error(`groupe en ordre libre mal fermé : ${syntax}`);
        const items = inner.map((n) => {
          if (n.kind !== 'opt' || n.alts.length !== 1 || !(n.alts[0] as Node[]).every((e) => e.kind === 'kw'))
            throw new Error(`un groupe en ordre libre ne contient que des options de mots-clés [mot] : ${syntax}`);
          return n.alts[0] as Node[];
        });
        if (items.length < 2) throw new Error(`groupe en ordre libre de moins de deux options : ${syntax}`);
        seq.push({ kind: 'free', items, id: ++groups });
        continue;
      }
      if (t === '[' || t === '{') {
        const alts: Node[][] = [parseSeq()];
        while (tokens[i] === '|') {
          i++;
          alts.push(parseSeq());
        }
        const close = tokens[i++];
        if (close !== (t === '[' ? ']' : '}')) throw new Error(`syntaxe mal fermée : ${syntax}`);
        seq.push({ kind: t === '[' ? 'opt' : 'alt', alts });
      } else if (t.startsWith('<')) {
        seq.push(parseParam(t));
      } else {
        if (!/^([a-z0-9][a-z0-9.:/+-]*|\*)$/.test(t)) throw new Error(`mot-clé invalide « ${t} » : ${syntax}`);
        seq.push({ kind: 'kw', word: t });
      }
    }
    return seq;
  };

  const root = parseSeq();
  if (i !== tokens.length) throw new Error(`syntaxe mal formée : ${syntax}`);

  const expand = (nodes: Node[]): SyntaxElem[][] => {
    let out: SyntaxElem[][] = [[]];
    for (const n of nodes) {
      if (n.kind === 'kw' || n.kind === 'param') {
        out = out.map((s) => [...s, n]);
        continue;
      }
      if (n.kind === 'free') {
        const tagged = n.items.map((item, rank) => item.map((e) => ({ ...(e as SyntaxElem & { kind: 'kw' }), group: n.id, groupOrder: rank })));
        const variants = arrangements(tagged).map((parts) => parts.flat());
        out = out.flatMap((s) => variants.map((v) => [...s, ...v]));
        if (out.length > 5000) throw new Error(`syntaxe trop combinatoire : ${syntax}`);
        continue;
      }
      const variants = n.alts.flatMap(expand);
      if (n.kind === 'opt') variants.unshift([]);
      out = out.flatMap((s) => variants.map((v) => [...s, ...v]));
      if (out.length > 5000) throw new Error(`syntaxe trop combinatoire : ${syntax}`);
    }
    return out;
  };

  const seqs = expand(root).filter((s) => s.length > 0);
  if (!seqs.length) throw new Error(`syntaxe vide : ${syntax}`);
  for (const s of seqs) {
    s.forEach((e, idx) => {
      if (e.kind === 'param' && (e.type === 'line' || e.type === 'interface-range') && idx !== s.length - 1) {
        throw new Error(`${e.label} doit terminer la commande : ${syntax}`);
      }
    });
  }
  return seqs;
}
