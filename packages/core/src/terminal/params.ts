import { compressIpv6 } from '../ipv6.js';
import { maskToPrefix, parseIpv4 } from '../ipv4.js';
import type { TerminalProfile } from './profile.js';
import type { SyntaxElem } from './syntax.js';

/** Contexte nécessaire à la lecture des paramètres : interfaces de l'équipement et types connus. */
export interface ParamContext {
  profile: TerminalProfile;
  deviceType: string;
  /** Interfaces physiques de l'équipement, forme canonique (`GigabitEthernet0/1`). */
  interfaces: readonly string[];
}

export interface ParamValue {
  /** Forme canonique, telle qu'elle sera enregistrée. */
  canon: string;
  /** Nombre de mots consommés. */
  consumed: number;
  /** Interfaces désignées (pour `interface-range`). */
  targets?: string[];
}

type Param = Extract<SyntaxElem, { kind: 'param' }>;

const NUMBER_PART = /^\d+(?:\/\d+)*(?:\.\d+)?$/;

function interfaceTypes(ctx: ParamContext) {
  return ctx.profile.interfaceTypes.filter((t) => !t.devices || t.devices.includes(ctx.deviceType));
}

/** Type d'interface désigné par un préfixe (`g`, `Gi`, `fa`), s'il est unique. */
function resolveInterfaceType(ctx: ParamContext, prefix: string) {
  const p = prefix.toLowerCase();
  const types = interfaceTypes(ctx);
  const exact = types.find((t) => t.name.toLowerCase() === p);
  if (exact) return exact;
  const found = types.filter((t) => t.name.toLowerCase().startsWith(p));
  return found.length === 1 ? found[0] : undefined;
}

/** `g0/1`, `Gi0/1`, `GigabitEthernet0/1` → `GigabitEthernet0/1` si l'équipement l'a (ou s'il peut la créer). */
export function resolveInterface(ctx: ParamContext, typePart: string, numberPart: string): string | null {
  if (!NUMBER_PART.test(numberPart)) return null;
  const type = resolveInterfaceType(ctx, typePart);
  if (!type) return null;
  const canonNumber = numberPart
    .split('/')
    .map((n) => String(Number.parseInt(n, 10)))
    .join('/');
  const name = `${type.name}${numberPart.includes('.') ? numberPart : canonNumber}`;
  if (type.virtual) {
    if (!/^\d+$/.test(numberPart)) return null;
    const n = Number(numberPart);
    if (type.range && (n < type.range[0] || n > type.range[1])) return null;
    return `${type.name}${n}`;
  }
  return ctx.interfaces.find((i) => i.toLowerCase() === name.toLowerCase()) ?? null;
}

function splitInterfaceToken(token: string): [string, string] | null {
  const m = /^([A-Za-z][A-Za-z-]*?)(\d.*)$/.exec(token);
  return m ? [m[1] as string, m[2] as string] : null;
}

/** Interface en un mot (`g0/1`) ou deux (`GigabitEthernet 0/1`). */
function readInterface(ctx: ParamContext, tokens: readonly string[], at: number): ParamValue | null {
  const token = tokens[at] as string;
  const split = splitInterfaceToken(token);
  if (split) {
    const name = resolveInterface(ctx, split[0], split[1]);
    return name ? { canon: name, consumed: 1 } : null;
  }
  const next = tokens[at + 1];
  if (/^[A-Za-z][A-Za-z-]*$/.test(token) && next !== undefined && NUMBER_PART.test(next)) {
    const name = resolveInterface(ctx, token, next);
    return name ? { canon: name, consumed: 2 } : null;
  }
  return null;
}

/**
 * Plage d'interfaces : `g1/0/1 - 4`, `g1/0/1-4,g1/0/10`, `fa0/1 - 2 , fa0/5`.
 * Renvoie la forme canonique (« GigabitEthernet1/0/1 - 4 , GigabitEthernet1/0/10 ») et la liste dépliée.
 */
export function readInterfaceRange(ctx: ParamContext, rest: string): ParamValue | null {
  const groups = rest
    .replace(/,/g, ' , ')
    .replace(/(\d)-/g, '$1 - ')
    .split(',')
    .map((g) => g.trim().split(/\s+/).filter(Boolean));
  if (!groups.length || groups.some((g) => !g.length)) return null;
  const canon: string[] = [];
  const targets: string[] = [];
  for (const g of groups) {
    let first: ParamValue | null = readInterface(ctx, g, 0);
    if (!first) return null;
    const after = g.slice(first.consumed);
    const base = first.canon;
    if (after.length === 0) {
      canon.push(base);
      targets.push(base);
      continue;
    }
    if (after.length !== 2 || after[0] !== '-' || !/^\d+$/.test(after[1] as string)) return null;
    const m = /^(.*?)(\d+)$/.exec(base);
    if (!m) return null;
    const start = Number(m[2]);
    const end = Number(after[1]);
    if (end < start) return null;
    for (let n = start; n <= end; n++) {
      const name = `${m[1]}${n}`;
      const split = splitInterfaceToken(name);
      const resolved = split ? resolveInterface(ctx, split[0], split[1]) : null;
      if (!resolved) return null;
      targets.push(resolved);
    }
    canon.push(`${base} - ${end}`);
    first = null;
  }
  return { canon: canon.join(' , '), consumed: Number.POSITIVE_INFINITY, targets };
}

/** `10,20,30-32` → [10, 20, 30, 31, 32] ; null si invalide ou hors bornes. */
export function parseNumberList(input: string, max: number): number[] | null {
  const out = new Set<number>();
  for (const part of input.split(',')) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] !== undefined ? Number(m[2]) : a;
    if (a < 1 || b > max || a > b) return null;
    for (let n = a; n <= b; n++) out.add(n);
  }
  return [...out].sort((x, y) => x - y);
}

/** [10, 20, 30, 31, 32] → `10,20,30-32` (comme IOS l'affiche). */
export function formatNumberList(values: readonly number[]): string {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && (sorted[j + 1] as number) === (sorted[j] as number) + 1) j++;
    parts.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return parts.join(',');
}

const isInt = (s: string) => /^\d+$/.test(s);

/** Lit un paramètre à la position `at`. Null si le mot ne convient pas. */
export function readParam(ctx: ParamContext, elem: Param, tokens: readonly string[], at: number, raw: string): ParamValue | null {
  const token = tokens[at];
  if (token === undefined) return null;
  switch (elem.type) {
    case 'line':
      return { canon: raw, consumed: Number.POSITIVE_INFINITY };
    case 'interface-range':
      return readInterfaceRange(ctx, raw);
    case 'interface':
      return readInterface(ctx, tokens, at);
    case 'word':
      return { canon: token, consumed: 1 };
    case 'number': {
      if (!isInt(token)) return null;
      const n = Number(token);
      if (elem.min !== undefined && n < elem.min) return null;
      if (elem.max !== undefined && n > elem.max) return null;
      return { canon: String(n), consumed: 1 };
    }
    case 'ipv4':
    case 'wildcard':
      return parseIpv4(token) !== null ? { canon: token, consumed: 1 } : null;
    case 'ipv4-mask': {
      const v = parseIpv4(token);
      return v !== null && maskToPrefix(v) !== null ? { canon: token, consumed: 1 } : null;
    }
    case 'area':
      if (isInt(token) && Number(token) <= 4294967295) return { canon: String(Number(token)), consumed: 1 };
      return parseIpv4(token) !== null ? { canon: token, consumed: 1 } : null;
    case 'prefix-length': {
      const m = /^\/(\d{1,2})$/.exec(token);
      return m && Number(m[1]) <= 32 ? { canon: `/${Number(m[1])}`, consumed: 1 } : null;
    }
    case 'ipv6': {
      const c = compressIpv6(token);
      return c ? { canon: c.toUpperCase(), consumed: 1 } : null;
    }
    case 'ipv6-prefix': {
      const m = /^([0-9A-Fa-f:]+)\/(\d{1,3})$/.exec(token);
      if (!m || Number(m[2]) > 128) return null;
      const c = compressIpv6(m[1] as string);
      return c ? { canon: `${c.toUpperCase()}/${Number(m[2])}`, consumed: 1 } : null;
    }
    case 'vlan-list':
      return parseNumberList(token, 4094) ? { canon: token, consumed: 1 } : null;
    case 'port': {
      if (isInt(token)) return Number(token) <= 65535 ? { canon: String(Number(token)), consumed: 1 } : null;
      const lower = token.toLowerCase();
      return ctx.profile.portNames[lower] !== undefined ? { canon: lower, consumed: 1 } : null;
    }
    case 'mac':
      return /^[0-9a-f]{1,4}\.[0-9a-f]{1,4}\.[0-9a-f]{1,4}$/i.test(token)
        ? {
            canon: token
              .toLowerCase()
              .split('.')
              .map((p) => p.padStart(4, '0'))
              .join('.'),
            consumed: 1,
          }
        : null;
  }
}

/** Étiquette affichée par `?` pour un paramètre (`A.B.C.D`, `WORD`, `<1-4094>`…). */
export function paramLabel(elem: Param): string {
  switch (elem.type) {
    case 'number':
      return `<${elem.min}-${elem.max}>`;
    case 'ipv4':
    case 'ipv4-mask':
    case 'wildcard':
      return 'A.B.C.D';
    case 'ipv6':
      return 'X:X:X:X::X';
    case 'ipv6-prefix':
      return 'X:X:X:X::X/<0-128>';
    case 'prefix-length':
      return '/nn';
    case 'word':
      return 'WORD';
    case 'line':
      return 'LINE';
    case 'vlan-list':
      return 'WORD';
    case 'port':
      return '<0-65535>';
    case 'mac':
      return 'H.H.H';
    case 'area':
      return '<0-4294967295>';
    case 'interface':
    case 'interface-range':
      return '<interface>';
  }
}

export function interfaceTypeHelp(ctx: ParamContext): [string, string][] {
  return interfaceTypes(ctx).map((t) => [t.name, t.help]);
}
