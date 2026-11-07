/**
 * Normalisation des commandes Cisco IOS, pour accepter les variantes équivalentes :
 * abréviations non ambiguës ("conf t", "int g0/0", "sh ip int br"), casse, espaces,
 * noms d'interface ("Gi0/0" = "GigabitEthernet0/0") et noms de ports ("www" = 80).
 *
 * Comme IOS, un mot abrégé n'est développé que s'il ne correspond qu'à un seul mot-clé.
 * Un préfixe ambigu reste tel quel, et ne correspondra donc pas à la forme attendue.
 */

const KEYWORDS = [
  'access', 'access-class', 'access-group', 'access-list', 'active', 'address', 'any', 'area', 'auto',
  'bandwidth', 'banner', 'boot', 'brief', 'cdp', 'channel-group', 'class', 'clock', 'configure',
  'console', 'copy', 'crypto', 'default', 'default-gateway', 'default-information', 'default-router',
  'delay', 'deny', 'description', 'desirable', 'disable', 'dns-server', 'domain-lookup', 'domain-name',
  'dot1q', 'duplex', 'dynamic', 'enable', 'encapsulation', 'end', 'eq', 'established', 'excluded-address',
  'exec-timeout', 'exit', 'extended', 'gateway', 'generate', 'gt', 'helper-address', 'host', 'hostname',
  'icmp', 'inside', 'interface', 'interfaces', 'ip', 'ipv6', 'key', 'line', 'lldp', 'local', 'logging', 'login', 'lt',
  'mac-address', 'mask', 'maximum', 'mode', 'modulus', 'name', 'nat', 'native', 'neighbor', 'neq',
  'network', 'no', 'ntp', 'ospf', 'outside', 'overload', 'passive-interface', 'password', 'permit',
  'pool', 'port-security', 'portfast', 'priority', 'range', 'remark', 'restrict', 'rip', 'route',
  'router', 'router-id', 'rsa', 'running-config', 'secret', 'server', 'service', 'show', 'shutdown',
  'snmp-server', 'source', 'spanning-tree', 'speed', 'ssh', 'standard', 'standby', 'startup-config',
  'static', 'sticky', 'switchport', 'tcp', 'terminal', 'transport', 'trunk', 'udp', 'unicast-routing',
  'username', 'version', 'violation', 'vlan', 'vty', 'write',
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

function expandKeyword(token: string): string {
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
  const tokens = line.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    const prev = out[out.length - 1];

    // "interface g0/0", "int range fa0/1 - 5" : le nom d'interface peut être collé ou séparé du numéro.
    // Uniquement après un mot qui annonce une interface, pour ne pas lire "hostname S1" comme Serial1.
    const expectsInterface = prev !== undefined && INTERFACE_CONTEXT.includes(prev);
    const iface = expectsInterface ? normalizeInterface(token) : null;
    if (iface) {
      out.push(iface);
      continue;
    }
    const next = tokens[i + 1];
    if (expectsInterface && next && /^\d[\d/.:]*$/.test(next)) {
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

    // Les valeurs (nombres, adresses, noms entre guillemets, mots de passe) restent telles quelles.
    if (/^[a-z][a-z-]*$/.test(token)) out.push(expandKeyword(token));
    else out.push(token);
  }
  return out.join(' ');
}

/** Vrai si la saisie équivaut à l'une des formes acceptées. */
export function commandMatches(input: string, accepted: readonly string[]): boolean {
  const got = normalizeCommand(input);
  return accepted.some((a) => normalizeCommand(a) === got);
}
