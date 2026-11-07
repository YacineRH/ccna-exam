import { describe, expect, it } from 'vitest';
import {
  checkLab,
  expandSyntax,
  formatNumberList,
  LabSession,
  parseLab,
  parseNumberList,
  parseTerminalProfile,
  TerminalDevice,
  type LabInput,
  type TerminalProfileInput,
} from '../src/index.js';

/*
 * Profil de test minimal, écrit pour ces tests : le moteur ne connaît aucun IOS « en dur ».
 * Le vrai profil CCNA vit dans packages/content et ses labs y sont joués.
 */
const CFG = ['config', 'config-if', 'config-if-range', 'config-line', 'config-vlan', 'config-ext-nacl'];
const IF = ['config-if', 'config-if-range'];
const PROFILE: TerminalProfileInput = {
  id: 'test-ios',
  name: 'Profil de test',
  startMode: 'user',
  configMode: 'config',
  endMode: 'privileged',
  doKeyword: 'do',
  modes: [
    { id: 'user', prompt: '{hostname}>', helpTitle: 'Exec commands:', unknownCommand: '% Unknown command or computer name' },
    { id: 'privileged', prompt: '{hostname}#', parent: 'user', helpTitle: 'Exec commands:' },
    { id: 'config', prompt: '{hostname}(config)#', parent: 'privileged', config: true, helpTitle: 'Configure commands:' },
    { id: 'config-if', prompt: '{hostname}(config-if)#', parent: 'config', config: true },
    { id: 'config-if-range', prompt: '{hostname}(config-if-range)#', parent: 'config', config: true },
    { id: 'config-line', prompt: '{hostname}(config-line)#', parent: 'config', config: true },
    { id: 'config-vlan', prompt: '{hostname}(config-vlan)#', parent: 'config', config: true, hidden: true },
    { id: 'config-ext-nacl', prompt: '{hostname}(config-ext-nacl)#', parent: 'config', config: true },
  ],
  messages: {
    invalid: "% Invalid input detected at '^' marker.",
    ambiguous: '% Ambiguous command:  "{input}"',
    incomplete: '% Incomplete command.',
    unrecognized: '% Unrecognized command',
    leaveConfig: '%SYS-5-CONFIG_I: Configured from console by console',
  },
  runningConfig: { header: 'Building configuration...\n!', footer: '!\nend' },
  deviceTypes: {
    router: { defaultHostname: 'Router', baseConfig: 'hostname Router', interfaceDefaults: ['shutdown'] },
    switch: { defaultHostname: 'Switch', baseConfig: 'hostname Switch' },
  },
  interfaceTypes: [
    { name: 'GigabitEthernet', help: 'GigabitEthernet IEEE 802.3z' },
    { name: 'FastEthernet', help: 'FastEthernet IEEE 802.3' },
    { name: 'Loopback', help: 'Loopback interface', virtual: true, range: [0, 2147483647] },
    { name: 'Port-channel', help: 'Ethernet Channel of interfaces', virtual: true, range: [1, 48] },
  ],
  portNames: { www: 80 },
  keywordHelp: { show: 'Show running system information', shutdown: 'Shutdown the selected interface', speed: 'Configure speed operation.' },
  commands: [
    { syntax: 'enable', modes: ['user'], goto: 'privileged' },
    { syntax: 'disable', modes: ['privileged'], goto: 'user' },
    { syntax: 'configure terminal', modes: ['privileged'], goto: 'config' },
    { syntax: 'show running-config [interface <interface>]', modes: ['privileged'], builtin: 'running-config' },
    { syntax: 'show {version|vlan [brief]}', modes: ['user', 'privileged'], output: '(non simulé)' },
    { syntax: 'copy running-config startup-config', modes: ['privileged'], output: '[OK]' },
    { syntax: 'exit', modes: CFG.slice(1), exit: true },
    { syntax: 'exit', modes: ['config'], exit: true },
    { syntax: 'end', modes: CFG, end: true },
    { syntax: 'hostname <word>', modes: ['config'], key: [0], set: { hostname: '{$1}' } },
    { syntax: 'interface <interface>', modes: ['config'], enter: { mode: 'config-if' } },
    { syntax: 'interface range <interface-range>', modes: ['config'], enter: { mode: 'config-if-range', range: true } },
    { syntax: 'vlan <1-4094>', modes: ['config'], devices: ['switch'], enter: { mode: 'config-vlan' } },
    { syntax: 'line vty <0-15> [<0-15>]', modes: ['config'], enter: { mode: 'config-line' } },
    { syntax: 'ip domain-lookup', modes: ['config'], negate: 'store' },
    {
      syntax: 'ipv6 route <ipv6-prefix> {<ipv6>|<interface> <ipv6>}',
      modes: ['config'],
      requires: [{ param: 2, notMatch: '^FE80:', message: '% Interface has to be specified for a link-local nexthop' }],
    },
    { syntax: 'ip domain-name <word>', modes: ['config'], key: [0, 1], set: { domain: '{$1}' } },
    {
      syntax: 'crypto key generate rsa modulus <360-4096>',
      modes: ['config'],
      store: false,
      set: { rsa: '{$1}' },
      requires: [
        { var: 'hostname', notEquals: '{defaultHostname}', message: '% Please define a hostname other than {defaultHostname}.' },
        { config: '^ip domain-name ', message: '% Please define a domain-name first.' },
      ],
      output: 'The name for the keys will be: {hostname}.{domain}',
    },
    { syntax: 'username <word> secret <line>', modes: ['config'], key: [0, 1], keyGroup: 'username', display: 'username {$1} secret 9 {mask:$3}' },
    { syntax: 'access-list <1-99> {permit|deny} {any|host <ipv4>|<ipv4> <wildcard>}', modes: ['config'] },
    { syntax: 'description <line>', modes: IF, key: [0] },
    { syntax: 'ip address <ipv4> <ipv4-mask>', modes: IF, key: [0, 1] },
    { syntax: 'shutdown', modes: IF },
    { syntax: 'speed {10|100|1000|auto}', modes: IF, key: [0] },
    { syntax: 'switchport mode {access|trunk}', modes: IF, devices: ['switch'], key: [0, 1] },
    {
      syntax: 'switchport access vlan <1-4094>',
      modes: IF,
      devices: ['switch'],
      key: [0, 1, 2],
      create: ['vlan {$1}'],
      createOutput: '% Access VLAN does not exist. Creating vlan {$1}',
    },
    { syntax: 'switchport trunk allowed vlan <vlan-list>', modes: IF, devices: ['switch'], list: { op: 'set', prefix: 'switchport trunk allowed vlan', max: 4094 } },
    { syntax: 'switchport trunk allowed vlan add <vlan-list>', modes: IF, devices: ['switch'], list: { op: 'add', prefix: 'switchport trunk allowed vlan', max: 4094 } },
    { syntax: 'switchport trunk allowed vlan remove <vlan-list>', modes: IF, devices: ['switch'], list: { op: 'remove', prefix: 'switchport trunk allowed vlan', max: 4094 } },
    {
      syntax: 'switchport port-security',
      modes: IF,
      devices: ['switch'],
      requires: [{ section: '^switchport mode (access|trunk)$', message: 'Command rejected: {target} is a dynamic port.' }],
    },
    { syntax: 'channel-group <1-48> mode {active|passive|on}', modes: IF, key: [0], create: ['interface Port-channel{$1}'] },
    { syntax: 'ip access-group {<1-199>|<word>} {in|out}', modes: IF, key: [0, 1, -1] },
    { syntax: 'name <word>', modes: ['config-vlan'], key: [0] },
    { syntax: 'login [local]', modes: ['config-line'], key: [0] },
    { syntax: 'ip access-list extended <word>', modes: ['config'], enter: { mode: 'config-ext-nacl' } },
    { syntax: '[<1-2147483647>] {permit|deny} {ip|tcp} {any|host <ipv4>} {any|host <ipv4>} [eq <port>]', modes: ['config-ext-nacl'], sequenced: true },
    { syntax: 'username <word> password <line>', modes: ['config'], key: [0, 1], keyGroup: 'username' },
    { syntax: 'transport input {ssh|telnet|all|none}', modes: ['config-line'], key: [0, 1] },
  ],
};

const profile = parseTerminalProfile(PROFILE);
const router = (startupConfig = '') =>
  new TerminalDevice(profile, { id: 'R1', type: 'router', interfaces: ['GigabitEthernet0/0-1'], startupConfig });
const sw = () =>
  new TerminalDevice(profile, { id: 'S1', type: 'switch', interfaces: ['GigabitEthernet1/0/1-4', 'FastEthernet0/1-2'], startupConfig: 'hostname S1' });
const run = (d: TerminalDevice, lines: string[]) => lines.map((l) => d.execute(l));

describe('syntaxe des commandes', () => {
  it('déplie options et alternatives', () => {
    const seqs = expandSyntax('show {version|vlan [brief]}');
    expect(seqs.map((s) => s.map((e) => (e.kind === 'kw' ? e.word : e.label)).join(' '))).toEqual(['show version', 'show vlan', 'show vlan brief']);
  });

  it('refuse une syntaxe mal formée', () => {
    expect(() => expandSyntax('show [version')).toThrow(/mal fermée/);
    expect(() => expandSyntax('description <line> extra')).toThrow(/terminer/);
    expect(() => expandSyntax('ip <inconnu>')).toThrow(/paramètre inconnu/);
  });

  it('listes de nombres', () => {
    expect(parseNumberList('10,20,30-32', 4094)).toEqual([10, 20, 30, 31, 32]);
    expect(parseNumberList('0', 4094)).toBeNull();
    expect(formatNumberList([32, 10, 31, 30, 20])).toBe('10,20,30-32');
  });
});

describe('modes et prompts', () => {
  it('enable, configure terminal, interface, exit, end', () => {
    const d = router('hostname R1');
    expect(d.prompt()).toBe('R1>');
    const prompts = run(d, ['enable', 'configure terminal', 'interface g0/0', 'exit', 'interface g0/1', 'end', 'disable']).map((r) => r.prompt);
    expect(prompts).toEqual(['R1#', 'R1(config)#', 'R1(config-if)#', 'R1(config)#', 'R1(config-if)#', 'R1#', 'R1>']);
  });

  it('Ctrl+Z revient au mode privilégié depuis n’importe quel sous-mode, avec le message de fin de configuration', () => {
    const d = router('hostname R1');
    run(d, ['en', 'conf t', 'line vty 0 4']);
    const r = d.execute('\x1a');
    expect(r.echo).toBe('R1(config-line)#^Z');
    expect(r.prompt).toBe('R1#');
    expect(r.output).toContain('%SYS-5-CONFIG_I');
    // Hors configuration, Ctrl+Z ne fait rien.
    expect(d.execute('\x1a').prompt).toBe('R1#');
  });

  it('exit depuis la configuration globale revient au mode privilégié', () => {
    const d = router();
    run(d, ['en', 'conf t']);
    const r = d.execute('exit');
    expect(r.prompt).toBe('Router#');
    expect(r.output).toContain('Configured from console');
  });

  it('le prompt suit le nom d’hôte', () => {
    const d = router();
    run(d, ['en', 'conf t']);
    expect(d.execute('hostname EDGE-1').prompt).toBe('EDGE-1(config)#');
  });

  it('une commande globale tapée dans un sous-mode y est exécutée, puis on reste en configuration globale', () => {
    const d = router('hostname R1');
    run(d, ['en', 'conf t', 'int g0/0']);
    expect(d.execute('hostname R2').prompt).toBe('R2(config)#');
    expect(d.execute('int g0/1').prompt).toBe('R2(config-if)#');
    // `interface` depuis une interface : on passe directement à la suivante.
    expect(d.execute('interface g0/0').prompt).toBe('R2(config-if)#');
  });

  it('do exécute une commande du mode privilégié sans quitter la configuration', () => {
    const d = router('hostname R1');
    run(d, ['en', 'conf t', 'int g0/0', 'description test']);
    const r = d.execute('do sh run int g0/0');
    expect(r.prompt).toBe('R1(config-if)#');
    expect(r.output).toContain('interface GigabitEthernet0/0\n shutdown\n description test');
  });
});

describe('abréviations et formes canoniques', () => {
  it('accepte les abréviations non ambiguës et enregistre la forme complète', () => {
    const d = router('hostname R1');
    run(d, ['en', 'conf t', 'int gi0/0', 'ip add 10.0.0.1 255.255.255.0', 'desc Vers R2', 'no shut']);
    expect(d.linesOf('interface GigabitEthernet0/0')).toEqual(['ip address 10.0.0.1 255.255.255.0', 'description Vers R2']);
  });

  it('nom d’interface en un ou deux mots, quelle que soit la casse', () => {
    const d = router();
    run(d, ['en', 'conf t']);
    expect(d.execute('interface GigabitEthernet 0/1').prompt).toBe('Router(config-if)#');
    expect(d.execute('INT G0/0').prompt).toBe('Router(config-if)#');
    expect(d.targets).toEqual(['interface GigabitEthernet0/0']);
  });

  it('une nouvelle valeur remplace l’ancienne (clé), les autres lignes s’ajoutent', () => {
    const d = router();
    run(d, ['en', 'conf t', 'int g0/0', 'ip address 10.0.0.1 255.255.255.0', 'ip address 10.0.0.2 255.255.255.0', 'ip access-group 10 in', 'ip access-group 20 out', 'ip access-group 30 in']);
    expect(d.linesOf('interface GigabitEthernet0/0')).toEqual(['shutdown', 'ip address 10.0.0.2 255.255.255.0', 'ip access-group 30 in', 'ip access-group 20 out']);
    run(d, ['exit', 'access-list 10 permit any', 'access-list 10 deny host 10.0.0.9']);
    expect(d.linesOf().filter((l) => l.startsWith('access-list'))).toEqual(['access-list 10 permit any', 'access-list 10 deny host 10.0.0.9']);
  });

  it('forme no : retire une ligne, garde « no … » pour un réglage actif par défaut', () => {
    const d = router();
    run(d, ['en', 'conf t', 'no ip domain-lookup', 'int g0/0', 'description à retirer', 'no description', 'no shutdown']);
    expect(d.linesOf('interface GigabitEthernet0/0')).toEqual([]);
    expect(d.linesOf()).toContain('no ip domain-lookup');
    run(d, ['ip domain-lookup']);
    expect(d.linesOf()).not.toContain('no ip domain-lookup');
  });

  it('ACL nommée : entrées rangées par numéro de séquence, enregistrées sans lui', () => {
    const d = router('hostname R1');
    run(d, ['en', 'conf t', 'ip access-list extended WEB', '20 deny ip any any', '10 permit tcp any host 10.0.0.5 eq www']);
    expect(d.linesOf('ip access-list extended WEB')).toEqual(['permit tcp any host 10.0.0.5 eq www', 'deny ip any any']);
    run(d, ['permit tcp any host 10.0.0.6 eq 443']);
    expect(d.section('ip access-list extended WEB')?.children?.map((e) => e.seq)).toEqual([10, 20, 30]);
    expect(d.execute('20 permit ip any any').output).toBe('% Duplicate sequence number');
    run(d, ['15 permit tcp any host 10.0.0.7 eq 22', 'no 20']);
    expect(d.linesOf('ip access-list extended WEB')).toEqual([
      'permit tcp any host 10.0.0.5 eq www',
      'permit tcp any host 10.0.0.7 eq 22',
      'permit tcp any host 10.0.0.6 eq 443',
    ]);
    run(d, ['no permit tcp any host 10.0.0.6 eq 443']);
    expect(d.linesOf('ip access-list extended WEB')).toHaveLength(2);
  });

  it('deux formes d’un même réglage se remplacent (keyGroup)', () => {
    const d = router('hostname R1');
    run(d, ['en', 'conf t', 'username admin password cisco', 'username admin secret Fort!', 'username bob password x']);
    expect(d.linesOf().filter((l) => l.startsWith('username'))).toEqual(['username admin secret Fort!', 'username bob password x']);
  });

  it('les secrets sont masqués dans la configuration affichée, pas dans l’état', () => {
    const d = router('hostname R1');
    run(d, ['en', 'conf t', 'username admin secret S3cret!']);
    expect(d.linesOf()).toContain('username admin secret S3cret!');
    const shown = d.execute('do show running-config').output;
    expect(shown).toMatch(/username admin secret 9 \$9\$/);
    expect(shown).not.toContain('S3cret!');
  });
});

describe('erreurs IOS', () => {
  it('% Invalid input detected, avec le marqueur sous le mot fautif', () => {
    const d = router('hostname R1');
    run(d, ['en', 'conf t', 'int g0/0']);
    const r = d.execute('ip adress 10.0.0.1 255.255.255.0');
    expect(r.status).toBe('error');
    expect(r.output).toBe(`${' '.repeat('R1(config-if)#ip '.length)}^\n% Invalid input detected at '^' marker.`);
  });

  it('une interface absente de l’équipement est refusée', () => {
    const d = router('hostname R1');
    run(d, ['en', 'conf t']);
    expect(d.execute('interface g0/7').output).toContain('% Invalid input detected');
    expect(d.execute('interface fa0/1').output).toContain('% Invalid input detected');
    expect(d.prompt()).toBe('R1(config)#');
  });

  it('% Ambiguous command', () => {
    const d = router('hostname R1');
    run(d, ['en', 'conf t', 'int g0/0']);
    // « s » : shutdown ou speed.
    const r = d.execute('s');
    expect(r.output).toBe('% Ambiguous command:  "s"');
    expect(d.linesOf('interface GigabitEthernet0/0')).toEqual(['shutdown']);
  });

  it('% Incomplete command', () => {
    const d = router('hostname R1');
    run(d, ['en', 'conf t']);
    expect(d.execute('ip domain-name').output).toBe('% Incomplete command.');
    expect(d.execute('int g0/0').status).toBe('ok');
    expect(d.execute('ip address 10.0.0.1').output).toBe('% Incomplete command.');
  });

  it('une commande de configuration en mode utilisateur est refusée', () => {
    const d = router('hostname R1');
    const r = d.execute('configure terminal');
    expect(r.output).toBe(`${' '.repeat('R1>'.length)}^\n% Invalid input detected at '^' marker.`);
    expect(d.execute('xyz').output).toBe('% Unknown command or computer name');
  });

  it('une valeur hors bornes ou mal formée est refusée', () => {
    const d = sw();
    run(d, ['en', 'conf t']);
    expect(d.execute('vlan 4095').status).toBe('error');
    expect(d.execute('int g1/0/1').status).toBe('ok');
    expect(d.execute('ip address 10.0.0.1 255.0.255.0').status).toBe('error');
  });

  it('les préconditions refusent la commande avec le message du profil', () => {
    const d = router();
    run(d, ['en', 'conf t']);
    expect(d.execute('crypto key generate rsa modulus 2048').output).toBe('% Please define a hostname other than Router.');
    run(d, ['hostname R1']);
    expect(d.execute('crypto key generate rsa modulus 2048').output).toBe('% Please define a domain-name first.');
    run(d, ['ip domain-name lab.local']);
    const r = d.execute('crypto key generate rsa modulus 2048');
    expect(r.status).toBe('ok');
    expect(r.output).toBe('The name for the keys will be: R1.lab.local');
    expect(d.vars.rsa).toBe('2048');
    // La commande n'est pas enregistrée dans la configuration.
    expect(d.linesOf().some((l) => l.startsWith('crypto'))).toBe(false);

    expect(d.execute('ipv6 route ::/0 fe80::1').output).toBe('% Interface has to be specified for a link-local nexthop');
    expect(d.execute('ipv6 route ::/0 g0/0 fe80::1').status).toBe('ok');
    expect(d.linesOf()).toContain('ipv6 route ::/0 GigabitEthernet0/0 FE80::1');

    const s = sw();
    run(s, ['en', 'conf t', 'int g1/0/1']);
    expect(s.execute('switchport port-security').output).toBe('Command rejected: GigabitEthernet1/0/1 is a dynamic port.');
    run(s, ['switchport mode access']);
    expect(s.execute('switchport port-security').status).toBe('ok');
  });
});

describe('aide ?', () => {
  it('liste les commandes du mode, avec leur aide', () => {
    const d = router('hostname R1');
    const r = d.execute('?');
    expect(r.status).toBe('help');
    expect(r.output.split('\n')[0]).toBe('Exec commands:');
    expect(r.output).toContain('enable');
    expect(r.output).toMatch(/show\s+Show running system information/);
    expect(r.output).not.toContain('configure');
  });

  it('complète un mot commencé et liste la suite, avec <cr> quand la commande peut s’arrêter', () => {
    const d = router('hostname R1');
    run(d, ['en', 'conf t', 'int g0/0']);
    expect(d.execute('s?').output).toBe('shutdown  speed');
    const next = d.execute('speed ?');
    expect(next.output).toMatch(/^ {2}10\s/m);
    expect(next.output).toContain('auto');
    expect(next.keep).toBe('speed ');
    expect(d.execute('shutdown ?').output.trim()).toBe('<cr>');
    expect(d.execute('ip address ?').output).toContain('A.B.C.D');
  });

  it('liste les types d’interface de l’équipement', () => {
    const d = router('hostname R1');
    run(d, ['en', 'conf t']);
    const r = d.execute('interface ?');
    expect(r.output).toContain('GigabitEthernet');
    expect(r.output).toContain('range');
  });

  it('signale une saisie invalide avant le ?', () => {
    const d = router('hostname R1');
    run(d, ['en', 'conf t']);
    expect(d.execute('xyz ?').output).toContain('% Invalid input detected');
  });
});

describe('commutateur : VLAN, plages, listes', () => {
  it('interface range applique la commande à chaque interface', () => {
    const d = sw();
    run(d, ['en', 'conf t', 'interface range g1/0/1 - 3, fa0/2', 'switchport mode access', 'switchport access vlan 10']);
    expect(d.prompt()).toBe('S1(config-if-range)#');
    for (const i of ['GigabitEthernet1/0/1', 'GigabitEthernet1/0/2', 'GigabitEthernet1/0/3', 'FastEthernet0/2']) {
      expect(d.linesOf(`interface ${i}`)).toEqual(['switchport mode access', 'switchport access vlan 10']);
    }
    expect(d.linesOf('interface GigabitEthernet1/0/4')).toEqual([]);
    // La plage est refusée si une interface n'existe pas.
    expect(d.execute('interface range g1/0/3-9').status).toBe('error');
  });

  it('switchport access vlan crée le VLAN absent ; les VLAN restent hors de la configuration affichée', () => {
    const d = sw();
    run(d, ['en', 'conf t', 'int g1/0/1', 'switchport mode access']);
    expect(d.execute('switchport access vlan 20').output).toBe('% Access VLAN does not exist. Creating vlan 20');
    expect(d.sectionHeaders()).toContain('vlan 20');
    run(d, ['vlan 30', 'name VENTES']);
    expect(d.linesOf('vlan 30')).toEqual(['name VENTES']);
    expect(d.execute('do show running-config').output).not.toContain('vlan 30');
  });

  it('switchport trunk allowed vlan : liste, ajout, retrait', () => {
    const d = sw();
    run(d, ['en', 'conf t', 'int g1/0/1', 'switchport mode trunk', 'switchport trunk allowed vlan 10,20', 'switchport trunk allowed vlan add 30-32']);
    expect(d.linesOf('interface GigabitEthernet1/0/1')).toContain('switchport trunk allowed vlan 10,20,30-32');
    run(d, ['switchport trunk allowed vlan remove 31']);
    expect(d.linesOf('interface GigabitEthernet1/0/1')).toContain('switchport trunk allowed vlan 10,20,30,32');
    run(d, ['no switchport trunk allowed vlan']);
    expect(d.linesOf('interface GigabitEthernet1/0/1')).toEqual(['switchport mode trunk']);
  });

  it('channel-group crée l’interface Port-channel', () => {
    const d = sw();
    run(d, ['en', 'conf t', 'int range g1/0/1-2', 'channel-group 1 mode active']);
    expect(d.sectionHeaders()).toContain('interface Port-channel1');
    expect(d.execute('interface po1').prompt).toBe('S1(config-if)#');
  });
});

const LAB: LabInput = {
  slug: 'test-lab',
  certification: 'test',
  domain: 'A',
  subtopic: 'A.1',
  difficulty: 'easy',
  title: 'Lab de test',
  statement: 'Configurez le commutateur S1 : VLAN 10 nommé USERS, port G1/0/1 en accès dans ce VLAN, sauvegarde.',
  topology: 'S1 G1/0/1 --- PC (VLAN 10)',
  profile: 'test-ios',
  devices: [{ id: 'S1', type: 'switch', interfaces: ['GigabitEthernet1/0/1-4'], startupConfig: 'hostname S1' }],
  objectives: [
    { id: 'vlan', description: 'Le VLAN 10 existe et s’appelle USERS.', check: { type: 'line', section: 'vlan 10', line: 'name USERS' } },
    {
      id: 'access',
      description: 'G1/0/1 est un port d’accès du VLAN 10.',
      check: {
        type: 'all',
        checks: [
          { type: 'line', section: 'interface GigabitEthernet1/0/1', line: 'switchport mode access' },
          { type: 'line', section: 'interface GigabitEthernet1/0/1', line: ['switchport access vlan 10'] },
        ],
      },
    },
    { id: 'saved', description: 'La configuration est enregistrée.', check: { type: 'command', command: 'copy running-config startup-config' } },
  ],
  hints: ['Créez le VLAN en configuration globale.', 'Le port doit être en mode accès.', 'switchport mode access puis switchport access vlan 10.'],
  solution: [{ device: 'S1', commands: ['enable', 'configure terminal', 'vlan 10', 'name USERS', 'interface g1/0/1', 'switchport mode access', 'switchport access vlan 10', 'end', 'copy running-config startup-config'] }],
  explanation: 'Un port d’accès appartient à un seul VLAN ; le mode accès désactive la négociation DTP.',
  reference: 'Guide de test',
};

describe('labs : objectifs', () => {
  const lab = parseLab(LAB);

  it('objectifs atteints quel que soit l’ordre des commandes', () => {
    const orders = [
      ['en', 'conf t', 'vlan 10', 'name USERS', 'int g1/0/1', 'sw mo acc', 'sw acc vl 10', 'end', 'copy run start'],
      ['en', 'conf t', 'int g1/0/1', 'switchport access vlan 10', 'switchport mode access', 'vlan 10', 'name USERS', '\x1a', 'copy running-config startup-config'],
      ['en', 'copy run start', 'conf t', 'interface range g1/0/1', 'switchport mode access', 'switchport access vlan 10', 'exit', 'vlan 10', 'name USERS'],
    ];
    for (const commands of orders) {
      const s = new LabSession(profile, lab);
      s.runAll([{ device: 'S1', commands }]);
      expect(s.achieved(), commands.join(' / ')).toEqual(['vlan', 'access', 'saved']);
    }
  });

  it('l’état compte, pas l’historique : un réglage annulé n’est plus atteint', () => {
    const s = new LabSession(profile, lab);
    s.runAll([{ device: 'S1', commands: ['en', 'conf t', 'vlan 10', 'name USERS', 'exit', 'vlan 10', 'no name'] }]);
    expect(s.achieved()).toEqual([]);
  });

  it('une solution incomplète n’atteint pas tous les objectifs', () => {
    const s = new LabSession(profile, lab);
    s.runAll([{ device: 'S1', commands: ['en', 'conf t', 'int g1/0/1', 'switchport access vlan 10'] }]);
    expect(s.achieved()).toEqual([]);
    expect(s.complete()).toBe(false);
  });

  it('expressions, sections multiples et couverture d’adresse', () => {
    const d = new LabSession(profile, parseLab({ ...LAB, objectives: [LAB.objectives[0]!] }));
    d.runAll([{ device: 'S1', commands: ['en', 'conf t', 'line vty 0 15', 'transport input ssh', 'exit', 'access-list 10 permit 192.168.10.0 0.0.0.255'] }]);
    expect(d.check({ type: 'regex', sectionPattern: '^line vty 0 (4|15)$', sections: 'any', pattern: '^transport input ssh$', absent: false })).toBe(true);
    expect(
      d.check({ type: 'regex', sections: 'any', pattern: '^access-list 10 permit (\\S+) (\\S+)$', absent: false, covers: { address: '192.168.10.77', groups: [1, 2], mask: false } }),
    ).toBe(true);
    expect(
      d.check({ type: 'regex', sections: 'any', pattern: '^access-list 10 permit (\\S+) (\\S+)$', absent: false, covers: { address: '192.168.11.1', groups: [1, 2], mask: false } }),
    ).toBe(false);
    expect(d.check({ type: 'line', section: 'interface GigabitEthernet1/0/9', sections: 'any', line: 'shutdown', absent: true })).toBe(true);
    // Ordre de lignes (pas forcément consécutives).
    expect(d.check({ type: 'sequence', sections: 'any', patterns: ['^access-list 10 ', '^line'] })).toBe(false);
    d.runAll([{ device: 'S1', commands: ['access-list 10 deny any'] }]);
    expect(d.check({ type: 'sequence', sections: 'any', patterns: ['^access-list 10 permit', '^access-list 10 deny'] })).toBe(true);
    expect(d.check({ type: 'sequence', sections: 'any', patterns: ['^access-list 10 deny', '^access-list 10 permit'] })).toBe(false);
    // Existence d'une section, même vide ; en-tête exact (sensible à la casse comme IOS).
    expect(d.check({ type: 'section', section: 'line vty 0 15', absent: false })).toBe(true);
    expect(d.check({ type: 'section', section: 'line vty 0 4', absent: true })).toBe(true);
    expect(d.check({ type: 'section', sectionPattern: '^LINE VTY', absent: false })).toBe(true);
  });

  it('checkLab : la solution réussit, un lab mal écrit est signalé', () => {
    expect(checkLab(profile, lab)).toEqual([]);
    const broken = parseLab({ ...LAB, solution: [{ device: 'S1', commands: ['enable', 'configure terminal', 'vlan 10', 'nmae USERS'] }] });
    const issues = checkLab(profile, broken);
    expect(issues.some((i) => i.includes('nmae USERS'))).toBe(true);
    expect(issues.some((i) => i.includes("n'atteint pas"))).toBe(true);
    const already = parseLab({ ...LAB, devices: [{ ...LAB.devices[0]!, startupConfig: 'hostname S1\nvlan 10\n name USERS' }] });
    expect(checkLab(profile, already)).toContain('objectifs déjà atteints au départ : vlan');
  });

  it('rejeu : les mêmes commandes donnent le même état et les mêmes sorties', () => {
    const commands = ['en', 'conf t', 'int g1/0/1', 'sw mo acc', 'sw acc vl 10', 'do show run'];
    const a = new LabSession(profile, lab).runAll([{ device: 'S1', commands }]);
    const b = new LabSession(profile, lab).runAll([{ device: 'S1', commands }]);
    expect(a).toEqual(b);
  });
});
