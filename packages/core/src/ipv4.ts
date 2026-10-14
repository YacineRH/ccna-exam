/** Outils IPv4 sans dépendance : conversion, masques, calcul de sous-réseau. */

export function parseIpv4(input: string): number | null {
  const parts = input.trim().split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
}

export function formatIpv4(value: number): string {
  const v = value >>> 0;
  return [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join('.');
}

export function prefixToMask(prefix: number): number {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) throw new RangeError(`préfixe invalide : ${prefix}`);
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

/** Renvoie le préfixe d'un masque contigu, ou null si le masque n'est pas valide. */
export function maskToPrefix(mask: number): number | null {
  const m = mask >>> 0;
  const inverted = ~m >>> 0;
  if ((inverted & (inverted + 1)) !== 0) return null;
  let bits = 0;
  for (let i = 31; i >= 0; i--) if ((m >>> i) & 1) bits++;
  return bits;
}

export interface Ipv4Subnet {
  address: string;
  prefix: number;
  mask: string;
  wildcard: string;
  network: string;
  broadcast: string;
  firstHost: string;
  lastHost: string;
  /** Nombre d'hôtes utilisables (RFC 3021 pour /31, 1 pour /32). */
  usableHosts: number;
  blockSize: number;
}

export function analyzeIpv4(address: string, prefix: number): Ipv4Subnet {
  const ip = parseIpv4(address);
  if (ip === null) throw new Error(`adresse IPv4 invalide : ${address}`);
  const mask = prefixToMask(prefix);
  const network = (ip & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const size = 2 ** (32 - prefix);

  let first = network + 1;
  let last = broadcast - 1;
  let usable = size - 2;
  if (prefix === 31) {
    first = network;
    last = broadcast;
    usable = 2;
  } else if (prefix === 32) {
    first = network;
    last = network;
    usable = 1;
  }

  return {
    address: formatIpv4(ip),
    prefix,
    mask: formatIpv4(mask),
    wildcard: formatIpv4(~mask >>> 0),
    network: formatIpv4(network),
    broadcast: formatIpv4(broadcast),
    firstHost: formatIpv4(first),
    lastHost: formatIpv4(last),
    usableHosts: usable,
    blockSize: size,
  };
}

/** Normalise une saisie IPv4 ("010.1.1.1 " -> "10.1.1.1"), ou null si invalide. */
export function normalizeIpv4(input: string): string | null {
  const v = parseIpv4(input);
  return v === null ? null : formatIpv4(v);
}
