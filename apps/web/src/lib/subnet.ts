import { normalizeIpv4, type Ipv4Subnet } from '@examforge/core';

export const SUBNET_FIELDS = [
  { id: 'network', label: 'Adresse réseau', kind: 'ip' },
  { id: 'mask', label: 'Masque', kind: 'ip' },
  { id: 'broadcast', label: 'Broadcast', kind: 'ip' },
  { id: 'usableHosts', label: 'Hôtes utilisables', kind: 'int' },
  { id: 'firstHost', label: 'Premier hôte', kind: 'ip' },
  { id: 'lastHost', label: 'Dernier hôte', kind: 'ip' },
] as const;

export type SubnetFieldId = (typeof SUBNET_FIELDS)[number]['id'];
export type SubnetAnswers = Record<SubnetFieldId, string>;

export interface FieldCheck {
  ok: boolean;
  expected: string;
  hint: string | null;
}

export function emptyAnswers(): SubnetAnswers {
  return { network: '', mask: '', broadcast: '', usableHosts: '', firstHost: '', lastHost: '' };
}

function expectedOf(answer: Ipv4Subnet, id: SubnetFieldId): string {
  return id === 'usableHosts' ? String(answer.usableHosts) : answer[id];
}

/** Explication courte d'une erreur classique (adresse du bloc suivant, réseau donné pour le 1er hôte…). */
function hintFor(answer: Ipv4Subnet, id: SubnetFieldId, given: string): string | null {
  const expected = expectedOf(answer, id);
  if (id === 'usableHosts') {
    const n = Number(given);
    if (n === answer.blockSize) return `${n} = taille du bloc ; retirez réseau et broadcast → attendu ${expected}`;
    return `attendu ${expected}`;
  }
  const ip = normalizeIpv4(given);
  if (ip === null) return `adresse invalide → attendu ${expected}`;
  if ((id === 'broadcast' || id === 'lastHost') && ip === incrementIp(answer.broadcast)) {
    return `${ip} est le réseau suivant → attendu ${expected}`;
  }
  if (id === 'firstHost' && ip === answer.network) return `${ip} est l'adresse réseau → attendu ${expected}`;
  if (id === 'lastHost' && ip === answer.broadcast) return `${ip} est le broadcast → attendu ${expected}`;
  if (id === 'network' && ip === answer.address && ip !== answer.network) return `c'est l'adresse donnée → attendu ${expected}`;
  return `attendu ${expected}`;
}

export function incrementIp(ip: string): string {
  const parts = ip.split('.').map(Number);
  let v = (((parts[0] ?? 0) * 256 + (parts[1] ?? 0)) * 256 + (parts[2] ?? 0)) * 256 + (parts[3] ?? 0);
  v = (v + 1) % 2 ** 32;
  return [Math.floor(v / 2 ** 24) % 256, Math.floor(v / 2 ** 16) % 256, Math.floor(v / 256) % 256, v % 256].join('.');
}

export function checkField(answer: Ipv4Subnet, id: SubnetFieldId, given: string): FieldCheck {
  const expected = expectedOf(answer, id);
  const value = given.trim();
  let ok: boolean;
  if (id === 'usableHosts') ok = /^\d+$/.test(value.replace(/\s/g, '')) && Number(value.replace(/\s/g, '')) === answer.usableHosts;
  else ok = normalizeIpv4(value) === expected;
  return { ok, expected, hint: ok ? null : value === '' ? `champ vide → attendu ${expected}` : hintFor(answer, id, value) };
}

export function checkAll(answer: Ipv4Subnet, given: SubnetAnswers): Record<SubnetFieldId, FieldCheck> {
  return Object.fromEntries(SUBNET_FIELDS.map((f) => [f.id, checkField(answer, f.id, given[f.id])])) as Record<
    SubnetFieldId,
    FieldCheck
  >;
}

/**
 * Index (0–3) de l'octet « intéressant » : celui où passe la frontière du masque.
 * Pour un préfixe multiple de 8 (/8, /16, /24), c'est le dernier octet à 255 (pas de bloc 1).
 */
export function interestingOctet(prefix: number): number {
  if (prefix <= 0) return 0;
  if (prefix % 8 === 0) return prefix / 8 - 1;
  return Math.min(3, Math.floor(prefix / 8));
}

export function toBits(octet: number): number[] {
  return Array.from({ length: 8 }, (_, i) => (octet >> (7 - i)) & 1);
}

export interface OctetBreakdown {
  index: number;
  addressOctet: number;
  maskOctet: number;
  addressBits: number[];
  maskBits: number[];
  blockSize: number;
  /** Début de chaque sous-réseau dans l'octet (abrégé si plus de 16 blocs). */
  starts: number[];
  currentStart: number;
  truncated: boolean;
}

export function octetBreakdown(answer: Ipv4Subnet): OctetBreakdown {
  const index = interestingOctet(answer.prefix);
  const addressOctet = Number(answer.address.split('.')[index]);
  const maskOctet = Number(answer.mask.split('.')[index]);
  const blockSize = 256 - maskOctet;
  const currentStart = Number(answer.network.split('.')[index]);
  const all: number[] = [];
  for (let s = 0; s < 256; s += blockSize) all.push(s);
  let starts = all;
  let truncated = false;
  if (all.length > 16) {
    const i = all.indexOf(currentStart);
    starts = all.slice(Math.max(0, i - 2), i + 3);
    truncated = true;
  }
  return {
    index,
    addressOctet,
    maskOctet,
    addressBits: toBits(addressOctet),
    maskBits: toBits(maskOctet),
    blockSize,
    starts,
    currentStart,
    truncated,
  };
}

export const OCTET_ORDINAL = ['1ᵉʳ', '2ᵉ', '3ᵉ', '4ᵉ'] as const;
