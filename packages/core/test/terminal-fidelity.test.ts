import { describe, expect, it } from 'vitest';
import { naturalCompare, parseTerminalProfile, TerminalDevice, type TerminalProfileInput } from '../src/index.js';

/*
 * Corrections de fidélité du bloc 4 : ordre d'affichage par rang, agrégats, blocs de lignes,
 * ACL numérotées éditées en mode nommé, commandes limitées à un type d'interface, réécriture
 * (groupe 0 de HSRP), garde sur un paramètre, ports nommés par protocole, forme `no` partagée.
 * Profil de test écrit pour ces tests : le moteur ne connaît aucun IOS « en dur ».
 */
const IF = ['config-if', 'config-if-range'];
const CFG = ['config', ...IF, 'config-line', 'config-std-nacl', 'config-ext-nacl'];
const PROFILE: TerminalProfileInput = {
  id: 'test-fidelite',
  name: 'Profil de test',
  startMode: 'privileged',
  configMode: 'config',
  endMode: 'privileged',
  doKeyword: 'do',
  modes: [
    { id: 'privileged', prompt: '{hostname}#' },
    { id: 'config', prompt: '{hostname}(config)#', parent: 'privileged', config: true },
    { id: 'config-if', prompt: '{hostname}(config-if)#', parent: 'config', config: true },
    { id: 'config-if-range', prompt: '{hostname}(config-if-range)#', parent: 'config', config: true },
    { id: 'config-line', prompt: '{hostname}(config-line)#', parent: 'config', config: true },
    { id: 'config-std-nacl', prompt: '{hostname}(config-std-nacl)#', parent: 'config', config: true },
    { id: 'config-ext-nacl', prompt: '{hostname}(config-ext-nacl)#', parent: 'config', config: true },
  ],
  messages: {
    invalid: "% Invalid input detected at '^' marker.",
    ambiguous: '% Ambiguous command:  "{input}"',
    incomplete: '% Incomplete command.',
    unrecognized: '% Unrecognized command',
  },
  runningConfig: { header: '!', footer: 'end' },
  deviceTypes: {
    router: { defaultHostname: 'Router', baseConfig: 'hostname Router', interfaceDefaults: ['shutdown'] },
    switch: { defaultHostname: 'Switch', baseConfig: 'hostname Switch' },
  },
  interfaceTypes: [
    { name: 'GigabitEthernet' },
    { name: 'FastEthernet' },
    { name: 'Serial' },
    { name: 'Loopback', virtual: true, range: [0, 100], rank: -2 },
    { name: 'Port-channel', virtual: true, range: [1, 6], rank: -1 },
    { name: 'Vlan', virtual: true, range: [1, 4094], rank: 2, devices: ['switch'] },
  ],
  portNames: { tcp: { www: 80, cmd: 514 }, udp: { tftp: 69, syslog: 514 } },
  commands: [
    { syntax: 'configure terminal', modes: ['privileged'], goto: 'config' },
    { syntax: 'show running-config', modes: ['privileged'], builtin: 'running-config' },
    { syntax: 'exit', modes: CFG.slice(1), exit: true },
    { syntax: 'end', modes: CFG, end: true },
    { syntax: 'hostname <word>', modes: ['config'], key: [0], set: { hostname: '{$1}' }, rank: 10 },
    { syntax: 'ip domain-lookup', modes: ['config'], negate: 'store', key: [0], keyGroup: 'lookup', rank: 20 },
    { syntax: 'ip domain lookup', modes: ['config'], negate: 'store', key: [0], keyGroup: 'lookup', rank: 20 },
    { syntax: 'interface <interface>', modes: ['config'], enter: { mode: 'config-if' }, rank: 30 },
    { syntax: 'interface range <interface-range>', modes: ['config'], enter: { mode: 'config-if-range', range: true } },
    { syntax: 'ip route <ipv4> <ipv4-mask> <ipv4>', modes: ['config'], rank: 40 },
    {
      syntax: 'ip access-list standard {<1-99>|<word>}',
      modes: ['config'],
      enter: { mode: 'config-std-nacl' },
      rank: 45,
      flatten: { match: '^ip access-list standard (\\d+)$', display: 'access-list $1', rank: 50 },
    },
    {
      syntax: 'ip access-list extended {<100-199>|<word>}',
      modes: ['config'],
      enter: { mode: 'config-ext-nacl' },
      rank: 45,
      flatten: { match: '^ip access-list extended (\\d+)$', display: 'access-list $1', rank: 50 },
    },
    { syntax: 'access-list <1-99> {permit|deny} {any|host <ipv4>}', modes: ['config'], into: { section: 'ip access-list standard {$1}', skip: 2 } },
    {
      syntax: 'access-list <100-199> {permit|deny} tcp any any [eq <port:tcp>]',
      modes: ['config'],
      into: { section: 'ip access-list extended {$1}', skip: 2 },
    },
    {
      syntax: 'access-list <100-199> {permit|deny} udp any any [eq <port:udp>]',
      modes: ['config'],
      into: { section: 'ip access-list extended {$1}', skip: 2 },
    },
    { syntax: '[<1-2147483647>] {permit|deny} {any|host <ipv4>}', modes: ['config-std-nacl'], sequenced: true },
    { syntax: '[<1-2147483647>] {permit|deny} tcp any any [eq <port:tcp>]', modes: ['config-ext-nacl'], sequenced: true },
    { syntax: '[<1-2147483647>] {permit|deny} udp any any [eq <port:udp>]', modes: ['config-ext-nacl'], sequenced: true },
    { syntax: 'line vty <0-15> [<0-15>]', modes: ['config'], enter: { mode: 'config-line' }, blocks: [[0, 4], [5, 15]], rank: 60 },
    { syntax: 'transport input {ssh|telnet}', modes: ['config-line'], key: [0, 1], rank: 20 },
    { syntax: 'exec-timeout <0-35791>', modes: ['config-line'], key: [0], rank: 10 },
    { syntax: 'description <line>', modes: IF, key: [0], rank: 10 },
    { syntax: 'switchport mode {access|trunk}', modes: IF, key: [0, 1], devices: ['switch'], rank: 20, onInterfaces: { switch: ['GigabitEthernet', 'FastEthernet', 'Port-channel'] } },
    { syntax: 'switchport trunk native vlan <1-4094>', modes: IF, key: [0, 1, 2, 3], devices: ['switch'], rank: 19 },
    {
      syntax: 'ip address <ipv4> <ipv4-mask>',
      modes: IF,
      key: [0, 1],
      rank: 30,
      onInterfaces: { switch: ['Vlan', 'Loopback'] },
    },
    { syntax: 'shutdown', modes: IF, rank: 40 },
    { syntax: 'clock rate <300-8000000>', modes: IF, key: [0, 1], rank: 45, onInterfaces: { '*': ['Serial'] } },
    {
      syntax: 'channel-group <1-6> mode {active|on}',
      modes: IF,
      key: [0],
      rank: 50,
      devices: ['switch'],
      create: ['interface Port-channel{$1}'],
      aggregate: { section: 'interface Port-channel{$1}', lines: '^switchport ' },
      onInterfaces: { switch: ['GigabitEthernet', 'FastEthernet'] },
    },
    { syntax: 'standby version {1|2}', modes: IF, key: [0, 1], rank: 34 },
    { syntax: 'standby ip <ipv4>', modes: IF, key: [0, 1], rank: 35 },
    { syntax: 'standby priority <0-255>', modes: IF, key: [0, 1], rank: 35 },
    {
      syntax: 'standby <0-4095> ip <ipv4>',
      modes: IF,
      key: [0, 1, 2],
      rank: 35,
      rewrite: { pattern: '^standby 0 ', replace: 'standby ' },
      requires: [{ when: { param: 1, min: 256 }, section: '^standby version 2$', invalidAt: 1 }],
    },
    {
      syntax: 'standby <0-4095> priority <0-255>',
      modes: IF,
      key: [0, 1, 2],
      rank: 35,
      rewrite: { pattern: '^standby 0 ', replace: 'standby ' },
      requires: [{ when: { param: 1, min: 256 }, section: '^standby version 2$', invalidAt: 1 }],
    },
  ],
};

const profile = parseTerminalProfile(PROFILE);
const router = () => new TerminalDevice(profile, { id: 'R1', type: 'router', interfaces: ['GigabitEthernet0/0-1', 'Serial0/0/0'], startupConfig: 'hostname R1' });
const sw = () =>
  new TerminalDevice(profile, { id: 'S1', type: 'switch', interfaces: ['FastEthernet0/1-3', 'GigabitEthernet0/1-2'], startupConfig: 'hostname S1' });
const run = (d: TerminalDevice, lines: string[]) => lines.map((l) => d.execute(l));
const conf = (d: TerminalDevice, lines: string[]) => run(d, ['configure terminal', ...lines]);
const showRun = (d: TerminalDevice) => d.renderConfig();

describe('ordre de show running-config', () => {
  it('les lignes suivent le rang donné par le profil, pas l’ordre de saisie', () => {
    const d = router();
    conf(d, ['interface g0/0', 'no shutdown', 'shutdown', 'ip address 10.0.0.1 255.255.255.0', 'description LAN', 'exit', 'line vty 0 4', 'transport input ssh', 'exec-timeout 5', 'exit', 'access-list 10 permit any', 'ip route 0.0.0.0 0.0.0.0 10.0.0.2']);
    const cfg = showRun(d);
    const at = (l: string) => cfg.indexOf(l);
    expect(at(' description LAN')).toBeLessThan(at(' ip address 10.0.0.1 255.255.255.0'));
    expect(at(' ip address 10.0.0.1 255.255.255.0')).toBeLessThan(at(' shutdown'));
    expect(at('ip route 0.0.0.0 0.0.0.0 10.0.0.2')).toBeLessThan(at('access-list 10 permit any'));
    expect(at('access-list 10 permit any')).toBeLessThan(at('line vty 0 4'));
    expect(at(' exec-timeout 5')).toBeLessThan(at(' transport input ssh'));
    // L'état, lui, garde l'ordre de saisie.
    expect(d.linesOf('interface GigabitEthernet0/0')).toEqual(['shutdown', 'ip address 10.0.0.1 255.255.255.0', 'description LAN']);
  });

  it('interfaces : types logiques avant ou après les physiques, physiques dans l’ordre de l’équipement', () => {
    const d = sw();
    conf(d, ['interface vlan 1', 'exit', 'interface range g0/1 - 2', 'channel-group 1 mode active', 'interface loopback 0']);
    const headers = showRun(d).filter((l) => l.startsWith('interface '));
    expect(headers).toEqual([
      'interface Loopback0',
      'interface Port-channel1',
      'interface FastEthernet0/1',
      'interface FastEthernet0/2',
      'interface FastEthernet0/3',
      'interface GigabitEthernet0/1',
      'interface GigabitEthernet0/2',
      'interface Vlan1',
    ]);
  });

  it('ordre naturel des en-têtes de même rang', () => {
    expect(['vlan 100', 'vlan 20', 'vlan 3'].sort(naturalCompare)).toEqual(['vlan 3', 'vlan 20', 'vlan 100']);
    expect(naturalCompare('line vty 0 4', 'line vty 5 15')).toBeLessThan(0);
  });
});

describe('EtherChannel : agrégat et membres', () => {
  it('l’agrégat créé par channel-group hérite de la configuration du premier membre', () => {
    const d = sw();
    conf(d, ['interface g0/1', 'switchport mode trunk', 'switchport trunk native vlan 99', 'channel-group 1 mode active']);
    expect(d.linesOf('interface Port-channel1')).toEqual(['switchport mode trunk', 'switchport trunk native vlan 99']);
  });

  it('un membre qui rejoint un agrégat existant en reçoit la configuration', () => {
    const d = sw();
    conf(d, ['interface po1', 'switchport mode trunk', 'interface fa0/3', 'switchport mode access', 'channel-group 1 mode active']);
    expect(d.linesOf('interface FastEthernet0/3')).toEqual(['channel-group 1 mode active', 'switchport mode trunk']);
  });

  it('la configuration posée sur l’agrégat se recopie sur les membres, forme no comprise', () => {
    const d = sw();
    conf(d, ['interface range g0/1 - 2', 'channel-group 1 mode active', 'interface po1', 'switchport mode trunk', 'description Uplink']);
    for (const m of ['interface GigabitEthernet0/1', 'interface GigabitEthernet0/2']) {
      expect(d.linesOf(m)).toContain('switchport mode trunk');
      // Seules les lignes déclarées par le profil sont recopiées.
      expect(d.linesOf(m)).not.toContain('description Uplink');
    }
    expect(d.linesOf('interface FastEthernet0/1')).not.toContain('switchport mode trunk');
    d.execute('no switchport mode trunk');
    expect(d.linesOf('interface GigabitEthernet0/1')).not.toContain('switchport mode trunk');
  });
});

describe('lignes VTY découpées en blocs', () => {
  it('line vty 0 15 vise les blocs 0 4 et 5 15', () => {
    const d = router();
    const r = conf(d, ['line vty 0 15', 'transport input ssh']);
    expect(r[2]?.status).toBe('ok');
    expect(d.sectionHeaders().filter((h) => h.startsWith('line'))).toEqual(['line vty 0 4', 'line vty 5 15']);
    expect(d.linesOf('line vty 0 4')).toEqual(['transport input ssh']);
    expect(d.linesOf('line vty 5 15')).toEqual(['transport input ssh']);
  });

  it('une plage partielle découpe le bloc, puis les morceaux identiques sont réunis', () => {
    const d = router();
    conf(d, ['line vty 0 4', 'transport input ssh', 'line vty 3', 'exec-timeout 5']);
    expect(showRun(d).filter((l) => l.startsWith('line'))).toEqual(['line vty 0 2', 'line vty 3', 'line vty 4']);
    expect(d.linesOf('line vty 3')).toEqual(['transport input ssh', 'exec-timeout 5']);
    d.execute('no exec-timeout 5');
    d.execute('exit');
    expect(d.sectionHeaders().filter((h) => h.startsWith('line'))).toEqual(['line vty 0 4']);
  });

  it('les blocs ne fusionnent pas entre eux, même identiques', () => {
    const d = router();
    conf(d, ['line vty 0 15', 'transport input ssh', 'exit']);
    expect(d.sectionHeaders().filter((h) => h.startsWith('line'))).toEqual(['line vty 0 4', 'line vty 5 15']);
  });

  it('une plage à l’envers est refusée', () => {
    const d = router();
    const r = conf(d, ['line vty 4 2']);
    expect(r[1]?.status).toBe('error');
    expect(r[1]?.output).toContain('% Invalid input');
  });
});

describe('ACL numérotées : access-list N et ip access-list … N sont la même ACL', () => {
  it('le mode nommé édite l’ACL numérotée, affichée à plat', () => {
    const d = router();
    conf(d, ['access-list 10 permit host 10.0.0.5', 'ip access-list standard 10', '5 deny host 10.0.0.6', 'exit']);
    expect(d.linesOf()).toEqual(expect.arrayContaining(['access-list 10 deny host 10.0.0.6', 'access-list 10 permit host 10.0.0.5']));
    const cfg = showRun(d);
    expect(cfg.indexOf('access-list 10 deny host 10.0.0.6')).toBeLessThan(cfg.indexOf('access-list 10 permit host 10.0.0.5'));
    expect(cfg).not.toContain('ip access-list standard 10');
  });

  it('une ACL nommée reste une section', () => {
    const d = router();
    conf(d, ['ip access-list standard ADMIN', 'permit any', 'exit']);
    expect(showRun(d)).toContain('ip access-list standard ADMIN');
    expect(d.linesOf()).not.toContain('access-list ADMIN permit any');
  });

  it('la commande est gardée dans l’historique telle que saisie', () => {
    const d = router();
    conf(d, ['access-list 10 permit any']);
    expect(d.history.map((h) => h.canonical)).toContain('access-list 10 permit any');
    expect(d.history.at(-1)?.changed).toBe(true);
  });

  it('no access-list N … retire toute l’ACL, comme IOS', () => {
    const d = router();
    conf(d, ['access-list 10 permit host 10.0.0.5', 'access-list 10 deny any', 'no access-list 10 deny any']);
    expect(d.linesOf().filter((l) => l.startsWith('access-list'))).toEqual([]);
  });
});

describe('commandes limitées à un type d’interface', () => {
  it('clock rate n’existe que sur une interface série', () => {
    const d = router();
    const r = conf(d, ['interface g0/0', 'clock rate 64000', 'interface s0/0/0', 'clock rate 64000']);
    expect(r[2]?.status).toBe('error');
    expect(r[2]?.output).toContain('% Invalid input');
    expect(r[4]?.status).toBe('ok');
  });

  it('ip address est refusée sur un port de commutateur, acceptée sur une SVI ; switchport l’inverse', () => {
    const d = sw();
    const r = conf(d, ['interface fa0/1', 'ip address 10.0.0.2 255.255.255.0', 'interface vlan 1', 'ip address 10.0.0.2 255.255.255.0', 'switchport mode access']);
    expect(r[2]?.status).toBe('error');
    expect(r[4]?.status).toBe('ok');
    expect(r[5]?.status).toBe('error');
  });

  it('sur un routeur, ip address reste permise partout', () => {
    const d = router();
    expect(conf(d, ['interface g0/0', 'ip address 10.0.0.1 255.255.255.0'])[2]?.status).toBe('ok');
  });

  it('l’aide ? ne propose pas une commande absente de ce type d’interface', () => {
    const d = router();
    conf(d, ['interface g0/0']);
    expect(d.execute('cl?').status).toBe('error');
    d.execute('interface s0/0/0');
    expect(d.execute('cl?').output).toContain('clock');
  });
});

describe('HSRP : groupe 0 et groupes de la version 2', () => {
  it('standby 0 ip et standby ip sont la même commande', () => {
    const d = router();
    conf(d, ['interface g0/0', 'standby 0 ip 10.0.0.254', 'standby 0 priority 110']);
    expect(d.linesOf('interface GigabitEthernet0/0')).toEqual(expect.arrayContaining(['standby ip 10.0.0.254', 'standby priority 110']));
    d.execute('standby ip 10.0.0.253');
    expect(d.linesOf('interface GigabitEthernet0/0').filter((l) => l.startsWith('standby ip'))).toEqual(['standby ip 10.0.0.253']);
    d.execute('no standby 0 ip 10.0.0.253');
    expect(d.linesOf('interface GigabitEthernet0/0').some((l) => l.startsWith('standby ip'))).toBe(false);
  });

  it('un groupe au-delà de 255 exige la version 2, avec le marqueur sous le numéro', () => {
    const d = router();
    const r = conf(d, ['interface g0/0', 'standby 300 ip 10.0.0.254']);
    expect(r[2]?.status).toBe('error');
    expect(r[2]?.output).toBe(`${' '.repeat('R1(config-if)#standby '.length)}^\n% Invalid input detected at '^' marker.`);
    run(d, ['standby version 2', 'standby 4095 ip 10.0.0.254']);
    expect(d.linesOf('interface GigabitEthernet0/0')).toContain('standby 4095 ip 10.0.0.254');
    expect(d.execute('standby 4096 ip 10.0.0.1').status).toBe('error');
  });
});

describe('ports nommés par protocole', () => {
  it('www est un port TCP, tftp un port UDP', () => {
    const d = router();
    const r = conf(d, ['access-list 100 permit tcp any any eq www', 'access-list 100 permit udp any any eq www', 'access-list 100 permit udp any any eq tftp', 'access-list 100 permit tcp any any eq tftp']);
    expect(r.map((x) => x.status)).toEqual(['ok', 'ok', 'error', 'ok', 'error']);
  });

  it('même numéro, noms différents : cmd (TCP 514) et syslog (UDP 514)', () => {
    const d = router();
    const r = conf(d, ['access-list 101 permit tcp any any eq cmd', 'access-list 101 permit udp any any eq syslog', 'access-list 101 permit tcp any any eq syslog']);
    expect(r.map((x) => x.status)).toEqual(['ok', 'ok', 'ok', 'error']);
  });
});

describe('forme no partagée entre deux orthographes', () => {
  it('no ip domain-lookup puis no ip domain lookup : une seule ligne', () => {
    const d = router();
    conf(d, ['no ip domain-lookup', 'no ip domain lookup']);
    expect(d.linesOf().filter((l) => l.includes('domain'))).toEqual(['no ip domain lookup']);
  });

  it('la forme positive de l’autre orthographe annule le no', () => {
    const d = router();
    conf(d, ['no ip domain-lookup', 'ip domain lookup']);
    expect(d.linesOf().filter((l) => l.includes('domain'))).toEqual([]);
  });
});
