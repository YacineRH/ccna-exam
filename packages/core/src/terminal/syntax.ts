/**
 * Lecture des syntaxes de commandes du profil : `ip route <ipv4> <ipv4-mask> {<ipv4>|<interface>} [<1-255>]`
 * devient la liste de ses formes linéaires (une par combinaison d'options et d'alternatives).
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
  | { kind: 'kw'; word: string }
  | { kind: 'param'; type: ParamType; label: string; min?: number; max?: number };

type Node = SyntaxElem | { kind: 'opt'; alts: Node[][] } | { kind: 'alt'; alts: Node[][] };

function parseParam(raw: string): SyntaxElem {
  const inner = raw.slice(1, -1);
  const range = /^(\d+)-(\d+)$/.exec(inner);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    if (min > max) throw new Error(`borne invalide : ${raw}`);
    return { kind: 'param', type: 'number', label: raw, min, max };
  }
  if (!(PARAM_TYPES as readonly string[]).includes(inner) || inner === 'number') throw new Error(`paramètre inconnu : ${raw}`);
  return { kind: 'param', type: inner as ParamType, label: raw };
}

/** Formes linéaires d'une syntaxe. Lève une erreur lisible si la syntaxe est mal formée. */
export function expandSyntax(syntax: string): SyntaxElem[][] {
  const tokens = syntax.match(/\[|\]|\{|\}|\||<[^>\s]+>|[^\s[\]{}|<>]+/g) ?? [];
  let i = 0;

  const parseSeq = (): Node[] => {
    const seq: Node[] = [];
    while (i < tokens.length) {
      const t = tokens[i] as string;
      if (t === ']' || t === '}' || t === '|') break;
      i++;
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
        if (!/^([a-z0-9][a-z0-9.:/-]*|\*)$/.test(t)) throw new Error(`mot-clé invalide « ${t} » : ${syntax}`);
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
