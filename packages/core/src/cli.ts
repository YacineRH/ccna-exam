import { compressIpv6 } from './ipv6.js';

/**
 * Normalisation des commandes Cisco IOS, pour accepter les variantes équivalentes :
 * abréviations non ambiguës ("conf t", "int g0/0", "sh ip int br"), casse, espaces,
 * noms d'interface ("Gi0/0" = "GigabitEthernet0/0"), noms de ports ("www" = 80),
 * plages ("g1/0/1-2" = "g1/0/1 - 2") et adresses IPv6 (forme canonique RFC 5952).
 *
 * Comme IOS, un mot abrégé n'est développé que s'il ne correspond qu'à un seul mot-clé.
 * Un préfixe ambigu reste tel quel, et ne correspondra donc pas à la forme attendue.
 */

const KEYWORDS = [
  'access', 'access-class', 'access-group', 'access-list', 'active', 'address', 'algorithm-type', 'allowed',
  'any', 'area', 'auto', 'auto-cost',
  'bandwidth', 'banner', 'boot', 'bpduguard', 'brief', 'cdp', 'channel-group', 'class', 'clock', 'configure',
  'console', 'copy', 'cost', 'crypto', 'default', 'default-gateway', 'default-information', 'default-router',
  'delay', 'deny', 'description', 'desirable', 'dhcp', 'disable', 'dns-server', 'domain-lookup', 'domain-name',
  'dot1q', 'duplex', 'dynamic', 'edge', 'enable', 'encapsulation', 'end', 'eq', 'established', 'excluded-address',
  'exec-timeout', 'exit', 'extended', 'full', 'gateway', 'generate', 'gt', 'half', 'helper-address', 'host', 'hostname',
  'icmp', 'input', 'inside', 'inspection', 'interface', 'interfaces', 'ip', 'ipv6', 'key', 'line', 'lldp', 'local',
  'logging', 'login', 'lt',
  'mac-address', 'mask', 'maximum', 'mode', 'modulus', 'name', 'nat', 'native', 'neighbor', 'neq',
  'network', 'no', 'nonegotiate', 'ntp', 'originate', 'ospf', 'outside', 'overload', 'passive-interface', 'password',
  'permit', 'point-to-point', 'pool', 'port-security', 'portfast', 'preempt', 'priority', 'rapid-pvst',
  'range', 'reference-bandwidth', 'remark', 'restrict', 'rip', 'route',
  'router', 'router-id', 'rsa', 'running-config', 'scrypt', 'secret', 'server', 'service', 'show',
  'shutdown', 'snmp-server', 'snooping', 'source', 'spanning-tree', 'speed', 'ssh', 'standard', 'standby',
  'startup-config', 'static', 'sticky', 'switchport', 'tcp', 'terminal', 'transport', 'trunk', 'trust', 'udp',
  'unicast-routing', 'username', 'version', 'violation', 'vlan', 'voice', 'vty', 'write',
];

/** Raccourcis d'usage courant qui ne sont pas des préfixes uniques dans la liste ci-dessus. */
const ALIASES: Record<string, string> = {
  t: 'terminal',
  int: 'interface',
  sh: 'show',
  br: 'brief',
  run: 'running-config',
  start: 'startup-config',
  conf: 'configure',
  en: 'enable',
  shut: 'shutdown',
  wr: 'write',
  // Abréviations ambiguës dans une liste à plat, mais sans ambiguïté là où IOS les attend.
  con: 'console',
  mo: 'mode',
  tr: 'trunk',
  stan: 'standby',
  stand: 'standby',
};

/**
 * Après certains mots, IOS ne propose que quelques mots-clés (`primary` et `secondary` n'existent
 * qu'après `root` : hors de la liste à plat, ils ne rendent pas `pri` ambigu pour `priority`) : une abréviation ambiguë dans la
 * liste à plat se lit d'abord parmi eux ("transport in ssh", "int ra g1/0/1 - 2", "snooping tru").
 */
const NEXT_KEYWORDS: Record<string, string[]> = {
  root: ['primary', 'secondary'],
  interface: ['range'],
  mode: ['access', 'trunk', 'active', 'passive', 'on', 'auto', 'desirable', 'dynamic', 'rapid-pvst', 'pvst', 'mst'],
  switchport: ['access', 'mode', 'trunk', 'voice', 'port-security', 'nonegotiate', 'priority', 'host'],
  transport: ['input', 'output', 'preferred'],
  snooping: ['trust', 'vlan', 'limit', 'information', 'database'],
  'access-list': ['standard', 'extended', 'resequence'],
  nat: ['inside', 'outside', 'pool', 'translation'],
  source: ['list', 'static', 'route-map'],
  rsa: ['general-keys', 'modulus', 'usage-keys', 'label', 'exportable'],
};

/** Ports nommés que IOS affiche ou accepte à la place du numéro. */
const PORT_NAMES: Record<string, string> = {
  ftp: '21',
  'ftp-data': '20',
  ssh: '22',
  telnet: '23',
  smtp: '25',
  domain: '53',
  www: '80',
  pop3: '110',
  ntp: '123',
  snmp: '161',
  bgp: '179',
  https: '443',
  syslog: '514',
  tftp: '69',
  bootps: '67',
  bootpc: '68',
};

const INTERFACE_TYPES: [RegExp, string][] = [
  [/^(?:g|gi|gig|giga|gigabit|gigabitethernet)(\d[\d/.:]*)$/, 'gigabitethernet'],
  [/^(?:f|fa|fast|fastethernet)(\d[\d/.:]*)$/, 'fastethernet'],
  [/^(?:te|ten|tengigabitethernet)(\d[\d/.:]*)$/, 'tengigabitethernet'],
  [/^(?:e|et|eth|ethernet)(\d[\d/.:]*)$/, 'ethernet'],
  [/^(?:s|se|ser|serial)(\d[\d/.:]*)$/, 'serial'],
  [/^(?:lo|loop|loopback)(\d+)$/, 'loopback'],
  [/^(?:po|port-channel)(\d+)$/, 'port-channel'],
  [/^(?:vl|vlan)(\d+)$/, 'vlan'],
];

const INTERFACE_CONTEXT = ['interface', 'interfaces', 'range', 'passive-interface', ',', '-'];

function expandKeyword(token: string, prev: string | undefined): string {
  const next = prev ? NEXT_KEYWORDS[prev] : undefined;
  const scoped = next?.filter((k) => k.startsWith(token));
  if (scoped?.length === 1) return scoped[0] as string;
  if (ALIASES[token]) return ALIASES[token];
  if (KEYWORDS.includes(token)) return token;
  const matches = KEYWORDS.filter((k) => k.startsWith(token));
  if (matches.length === 1) return matches[0] as string;
  // "acc" -> access plutôt que access-list : le mot de base l'emporte sur ses composés.
  const base = matches.find((m) => matches.every((o) => o === m || o.startsWith(`${m}-`)));
  return base ?? token;
}

function normalizeInterface(token: string): string | null {
  for (const [re, name] of INTERFACE_TYPES) {
    const m = re.exec(token);
    if (m) return `${name}${m[1]}`;
  }
  return null;
}

/** Forme canonique d'une ligne de commande IOS. */
export function normalizeCommand(line: string): string {
  const tokens = line
    .trim()
    .toLowerCase()
    // Listes et plages : "g1/0/1,g1/0/3" et "g1/0/1-2" se lisent comme "g1/0/1 , g1/0/3" et "g1/0/1 - 2".
    .replace(/,/g, ' , ')
    .replace(/(\d)-(?=\d)/g, '$1 - ')
    .replace(/(\s)-(?=\d)/g, '$1- ')
    .split(/\s+/)
    .filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    const prev = out[out.length - 1];

    // "interface g0/0", "int range fa0/1 - 5" : le nom d'interface peut être collé ou séparé du numéro.
    // Uniquement après un mot qui annonce une interface, pour ne pas lire "hostname S1" comme Serial1.
    const expectsInterface = prev !== undefined && INTERFACE_CONTEXT.includes(prev);
    // Un nom d'interface avec un « / » (g0/0, s0/0/1) est sans ambiguïté, où qu'il soit :
    // interface de sortie d'une route statique, `ip nat inside source list 1 interface g0/1 overload`…
    const iface = expectsInterface || token.includes('/') ? normalizeInterface(token) : null;
    if (iface) {
      out.push(iface);
      continue;
    }
    const next = tokens[i + 1];
    // "interface Gi 0/0", et "GigabitEthernet 0/1" ailleurs quand le numéro porte un « / ».
    if (next && /^\d[\d/.:]*$/.test(next) && (expectsInterface || (/^[a-z-]+$/.test(token) && next.includes('/')))) {
      const joined = normalizeInterface(token + next);
      if (joined) {
        out.push(joined);
        i++;
        continue;
      }
    }

    // Opérateurs de port : "eq www" -> "eq 80".
    if (prev && ['eq', 'neq', 'gt', 'lt'].includes(prev) && PORT_NAMES[token]) {
      out.push(PORT_NAMES[token]);
      continue;
    }

    // Adresses IPv6, avec ou sans longueur de préfixe : forme canonique.
    const v6 = /^([0-9a-f:]+)(\/\d{1,3})?$/.exec(token);
    const compressed = v6 && token.includes(':') ? compressIpv6(v6[1] as string) : null;
    if (compressed) {
      out.push(compressed + (v6?.[2] ?? ''));
      continue;
    }

    // Les valeurs (nombres, adresses, noms entre guillemets, mots de passe) restent telles quelles.
    if (/^[a-z][a-z-]*$/.test(token)) out.push(expandKeyword(token, prev));
    else out.push(token);
  }
  return out.join(' ');
}

/** Vrai si la saisie équivaut à l'une des formes acceptées. */
export function commandMatches(input: string, accepted: readonly string[]): boolean {
  const got = normalizeCommand(input);
  return accepted.some((a) => normalizeCommand(a) === got);
}
