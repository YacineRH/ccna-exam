import { analyzeIpv4, formatIpv4, parseIpv4, type Ipv4Subnet } from './ipv4.js';
import { createRng, randomInt, type Rng } from './random.js';

export interface SubnetExercise {
  address: string;
  prefix: number;
  answer: Ipv4Subnet;
}

export interface SubnetExerciseOptions {
  minPrefix?: number;
  maxPrefix?: number;
  /** Plage d'adresses : privées (RFC 1918) par défaut, comme à l'examen. */
  privateOnly?: boolean;
}

function randomPrivateAddress(rng: Rng): number {
  const kind = randomInt(rng, 0, 2);
  if (kind === 0) return (10 << 24) | (randomInt(rng, 0, 255) << 16) | (randomInt(rng, 0, 255) << 8) | randomInt(rng, 0, 255);
  if (kind === 1) return (172 << 24) | (randomInt(rng, 16, 31) << 16) | (randomInt(rng, 0, 255) << 8) | randomInt(rng, 0, 255);
  return (192 << 24) | (168 << 16) | (randomInt(rng, 0, 255) << 8) | randomInt(rng, 0, 255);
}

function randomPublicAddress(rng: Rng): number {
  return (randomInt(rng, 1, 223) << 24) | (randomInt(rng, 0, 255) << 16) | (randomInt(rng, 0, 255) << 8) | randomInt(rng, 0, 255);
}

/** Exercice infini : une adresse hôte et un préfixe, avec la correction complète. */
export function generateSubnetExercise(seed: number, options: SubnetExerciseOptions = {}): SubnetExercise {
  const rng = createRng(seed);
  const minPrefix = options.minPrefix ?? 8;
  const maxPrefix = options.maxPrefix ?? 30;
  if (minPrefix < 0 || maxPrefix > 32 || minPrefix > maxPrefix) throw new RangeError('plage de préfixes invalide');
  const prefix = randomInt(rng, minPrefix, maxPrefix);

  // On évite de tomber pile sur l'adresse réseau ou de broadcast quand une adresse hôte existe.
  for (let attempt = 0; attempt < 20; attempt++) {
    const raw = (options.privateOnly ?? true) ? randomPrivateAddress(rng) : randomPublicAddress(rng);
    const address = formatIpv4(raw >>> 0);
    const answer = analyzeIpv4(address, prefix);
    if (prefix >= 31 || (address !== answer.network && address !== answer.broadcast)) {
      return { address, prefix, answer };
    }
  }
  const address = formatIpv4(randomPrivateAddress(rng) >>> 0);
  return { address, prefix, answer: analyzeIpv4(address, prefix) };
}

export interface VlsmRequest {
  name: string;
  hosts: number;
}

export interface VlsmAllocation extends Ipv4Subnet {
  name: string;
  requestedHosts: number;
}

/** Plus petit préfixe offrant au moins `hosts` adresses utilisables. */
export function prefixForHosts(hosts: number): number {
  if (hosts < 1) throw new RangeError('au moins un hôte');
  if (hosts === 1) return 32;
  if (hosts === 2) return 30;
  for (let p = 30; p >= 0; p--) if (2 ** (32 - p) - 2 >= hosts) return p;
  throw new RangeError('trop d\'hôtes');
}

/** Plan VLSM : besoins triés du plus grand au plus petit, alloués à la suite. */
export function planVlsm(base: string, basePrefix: number, requests: readonly VlsmRequest[]): VlsmAllocation[] {
  const root = analyzeIpv4(base, basePrefix);
  const end = root.blockSize;
  let cursor = 0;
  const baseValue = parseIpv4(root.network) as number;

  const sorted = [...requests].sort((a, b) => b.hosts - a.hosts || a.name.localeCompare(b.name));
  const out: VlsmAllocation[] = [];
  for (const req of sorted) {
    const prefix = prefixForHosts(req.hosts);
    const size = 2 ** (32 - prefix);
    cursor = Math.ceil(cursor / size) * size;
    if (cursor + size > end) throw new RangeError(`${base}/${basePrefix} trop petit pour ${req.name}`);
    const subnet = analyzeIpv4(formatIpv4(baseValue + cursor), prefix);
    out.push({ ...subnet, name: req.name, requestedHosts: req.hosts });
    cursor += size;
  }
  return out;
}
