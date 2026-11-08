import { describe, expect, it } from 'vitest';
import { TerminalDevice } from '@examforge/core';
import { loadLabProfile } from '../src/index.js';

/*
 * Fidélité IOS du profil CCNA (commandes de 2.3, 2.5, 4.2, 4.4, 4.5 et 5.8) : syntaxe, aide `?`,
 * forme `no`, remplacement d'un réglage par un autre et rendu exact dans show running-config.
 */
const profile = loadLabProfile('ccna')!;
const router = () =>
  new TerminalDevice(profile, { id: 'R1', type: 'router', interfaces: ['GigabitEthernet0/0-1', 'Serial0/0/0'], startupConfig: 'hostname R1' });
const sw = () =>
  new TerminalDevice(profile, { id: 'S1', type: 'switch', interfaces: ['FastEthernet0/1-4', 'GigabitEthernet0/1-2'], startupConfig: 'hostname S1' });
const conf = (d: TerminalDevice, lines: string[]) => ['enable', 'configure terminal', ...lines].map((l) => d.execute(l)).slice(2);
const ok = (d: TerminalDevice, lines: string[]) => {
  const errors = conf(d, lines).filter((r) => r.status === 'error');
  expect(errors.map((e) => `${e.echo}\n${e.output}`)).toEqual([]);
};
const cfg = (d: TerminalDevice) => d.renderConfig();
/** Lignes affichées qui commencent par l'un des préfixes, dans l'ordre d'affichage. */
const shown = (d: TerminalDevice, ...prefixes: string[]) => cfg(d).filter((l) => prefixes.some((p) => l.startsWith(p)));
const section = (d: TerminalDevice, header: string) => {
  const lines = cfg(d);
  const at = lines.indexOf(header);
  if (at < 0) return [];
  const out: string[] = [];
  for (let i = at + 1; i < lines.length && lines[i]!.startsWith(' '); i++) out.push(lines[i]!.slice(1));
  return out;
};
const invalidAt = (prompt: string, typedBefore: string) => `${' '.repeat(prompt.length + typedBefore.length)}^\n% Invalid input detected at '^' marker.`;

describe('2.3 CDP et LLDP', () => {
  it('cdp timer et cdp holdtime : remplacement, valeur par défaut non affichée, forme no', () => {
    const d = router();
    ok(d, ['cdp timer 30', 'cdp holdtime 120', 'cdp timer 20']);
    expect(shown(d, 'cdp ')).toEqual(['cdp timer 20', 'cdp holdtime 120']);
    ok(d, ['cdp timer 60', 'no cdp holdtime']);
    expect(shown(d, 'cdp ')).toEqual([]);
    expect(conf(d, ['cdp timer 4', 'cdp timer 255', 'cdp holdtime 9', 'cdp holdtime 256']).map((r) => r.status)).toEqual(['error', 'error', 'error', 'error']);
    ok(d, ['cdp holdtime 255', 'cdp holdtime 180']);
    expect(shown(d, 'cdp ')).toEqual([]);
  });

  it('aide ? de cdp et de ses minuteries', () => {
    const d = router();
    conf(d, []);
    const help = d.execute('cdp ?').output;
    expect(help).toMatch(/holdtime\s+Specify the holdtime \(in sec\) to be sent in packets/);
    expect(help).toMatch(/run\s+Enable CDP/);
    expect(help).toMatch(/timer\s+Specify the rate at which CDP packets are sent \(in sec\)/);
    expect(d.execute('cdp timer ?').output).toMatch(/<5-254>\s+Rate at which CDP packets are sent/);
    expect(d.execute('cdp holdtime ?').output).toMatch(/<10-255>\s+Length {2}of time {2}\(in sec\) that receiver must keep this packet/);
  });

  it('no cdp run et no cdp enable sont affichés, la forme positive les efface', () => {
    const d = router();
    ok(d, ['no cdp run', 'interface g0/0', 'no cdp enable']);
    expect(cfg(d)).toContain('no cdp run');
    expect(section(d, 'interface GigabitEthernet0/0')).toContain('no cdp enable');
    ok(d, ['cdp enable', 'exit', 'cdp run']);
    expect(cfg(d).some((l) => l.includes('cdp'))).toBe(false);
  });

  it('lldp timer et lldp holdtime : bornes, remplacement, valeur par défaut non affichée', () => {
    const d = sw();
    ok(d, ['lldp run', 'lldp timer 5', 'lldp holdtime 0', 'lldp timer 65534']);
    expect(shown(d, 'lldp ')).toEqual(['lldp timer 65534', 'lldp holdtime 0', 'lldp run']);
    expect(conf(d, ['lldp timer 4', 'lldp timer 65535', 'lldp holdtime 65536']).map((r) => r.status)).toEqual(['error', 'error', 'error']);
    ok(d, ['lldp timer 30', 'lldp holdtime 120']);
    expect(shown(d, 'lldp ')).toEqual(['lldp run']);
    ok(d, ['lldp timer 10', 'no lldp timer']);
    expect(shown(d, 'lldp ')).toEqual(['lldp run']);
  });

  it('lldp transmit et lldp receive : actifs par défaut, seule la forme no s’affiche', () => {
    const d = sw();
    ok(d, ['interface fa0/1', 'lldp transmit', 'lldp receive']);
    expect(section(d, 'interface FastEthernet0/1')).toEqual([]);
    ok(d, ['no lldp transmit', 'no lldp receive']);
    expect(section(d, 'interface FastEthernet0/1')).toEqual(['no lldp transmit', 'no lldp receive']);
    ok(d, ['lldp receive']);
    expect(section(d, 'interface FastEthernet0/1')).toEqual(['no lldp transmit']);
    expect(d.execute('lldp ?').output).toMatch(/receive\s+Enable LLDP reception on interface\n\s+transmit\s+Enable LLDP transmission on interface/);
  });

  it('lldp transmit n’existe pas sur une SVI', () => {
    const d = sw();
    const r = conf(d, ['interface vlan 1', 'lldp transmit']);
    expect(r[1]?.status).toBe('error');
  });
});

describe('2.5 STP sur l’interface', () => {
  it('spanning-tree cost et port-priority : remplacement, défaut 128 non affiché', () => {
    const d = sw();
    ok(d, ['interface fa0/1', 'spanning-tree cost 19', 'spanning-tree port-priority 64', 'spanning-tree cost 200000000']);
    expect(section(d, 'interface FastEthernet0/1')).toEqual(['spanning-tree cost 200000000', 'spanning-tree port-priority 64']);
    ok(d, ['spanning-tree port-priority 128', 'no spanning-tree cost']);
    expect(section(d, 'interface FastEthernet0/1')).toEqual([]);
    expect(conf(d, ['interface fa0/1', 'spanning-tree cost 0', 'spanning-tree port-priority 256']).map((r) => r.status)).toEqual(['ok', 'error', 'error']);
  });

  it('port-priority par incréments de 16, comme IOS', () => {
    const d = sw();
    const r = conf(d, ['interface fa0/1', 'spanning-tree port-priority 100', 'spanning-tree vlan 10 port-priority 33']);
    const msg = '% Port Priority in increments of 16 is required\n% Allowed values are:\n  0   16  32  48  64  80  96  112 128 144 160 176 192 208 224 240';
    expect(r[1]?.output).toBe(msg);
    expect(r[2]?.output).toBe(msg);
    expect(section(d, 'interface FastEthernet0/1')).toEqual([]);
    ok(d, ['interface fa0/1', 'spanning-tree port-priority 0', 'spanning-tree port-priority 240']);
    expect(section(d, 'interface FastEthernet0/1')).toEqual(['spanning-tree port-priority 240']);
  });

  it('spanning-tree vlan <liste> cost / port-priority : un réglage par liste de VLAN', () => {
    const d = sw();
    ok(d, ['interface g0/1', 'spanning-tree vlan 10 cost 4', 'spanning-tree vlan 20 cost 8', 'spanning-tree vlan 10 cost 2', 'spanning-tree vlan 10,20 port-priority 32']);
    expect(section(d, 'interface GigabitEthernet0/1')).toEqual(['spanning-tree vlan 10 cost 2', 'spanning-tree vlan 20 cost 8', 'spanning-tree vlan 10,20 port-priority 32']);
    ok(d, ['spanning-tree vlan 10,20 port-priority 128', 'no spanning-tree vlan 20 cost 8']);
    expect(section(d, 'interface GigabitEthernet0/1')).toEqual(['spanning-tree vlan 10 cost 2']);
    // En configuration globale, spanning-tree vlan … priority reste la commande globale.
    expect(conf(d, ['interface g0/1', 'spanning-tree vlan 10 priority 4096'])[1]?.prompt).toBe('S1(config)#');
    expect(d.execute('interface g0/1').status).toBe('ok');
    expect(d.execute('spanning-tree vlan 10 ?').output).toMatch(/cost\s+Change an interface's per VLAN spanning tree path cost\n\s+port-priority\s+Change an interface's spanning tree port priority/);
  });

  it('spanning-tree guard {root|loop|none} : un seul mode de garde, none affiché', () => {
    const d = sw();
    ok(d, ['interface fa0/2', 'spanning-tree guard root', 'spanning-tree guard loop']);
    expect(section(d, 'interface FastEthernet0/2')).toEqual(['spanning-tree guard loop']);
    ok(d, ['spanning-tree guard none']);
    expect(section(d, 'interface FastEthernet0/2')).toEqual(['spanning-tree guard none']);
    ok(d, ['no spanning-tree guard']);
    expect(section(d, 'interface FastEthernet0/2')).toEqual([]);
    const help = d.execute('spanning-tree guard ?').output;
    expect(help).toBe('  loop  Set guard mode to loop guard on interface\n  none  Set guard mode to none\n  root  Set guard mode to root guard on interface');
  });

  it('ordre dans l’interface : portfast, bpduguard, guard, cost, port-priority, par VLAN, no cdp enable', () => {
    const d = sw();
    ok(d, ['interface fa0/3', 'no cdp enable', 'spanning-tree vlan 1 port-priority 16', 'spanning-tree vlan 1 cost 5', 'spanning-tree port-priority 32', 'spanning-tree cost 7', 'spanning-tree guard root', 'spanning-tree bpduguard enable']);
    expect(section(d, 'interface FastEthernet0/3')).toEqual([
      'spanning-tree bpduguard enable',
      'spanning-tree guard root',
      'spanning-tree cost 7',
      'spanning-tree port-priority 32',
      'spanning-tree vlan 1 cost 5',
      'spanning-tree vlan 1 port-priority 16',
      'no cdp enable',
    ]);
  });

  it('commandes de commutateur : absentes d’un routeur', () => {
    const d = router();
    expect(conf(d, ['interface g0/0', 'spanning-tree cost 19'])[1]?.status).toBe('error');
  });
});

describe('4.2 NTP et fuseau horaire', () => {
  it('ntp server [prefer] : une ligne par serveur, prefer remplace', () => {
    const d = router();
    ok(d, ['ntp server 10.0.0.1', 'ntp server 10.0.0.2', 'ntp server 10.0.0.1 prefer']);
    expect(shown(d, 'ntp ')).toEqual(['ntp server 10.0.0.1 prefer', 'ntp server 10.0.0.2']);
    ok(d, ['no ntp server 10.0.0.1']);
    expect(shown(d, 'ntp ')).toEqual(['ntp server 10.0.0.2']);
  });

  it('ntp master [stratum], ntp source, ntp update-calendar : ordre IOS après les lignes', () => {
    const d = router();
    ok(d, ['line console 0', 'exit', 'ntp server 10.0.0.1 prefer', 'ntp update-calendar', 'ntp master', 'ntp source loopback 0', 'ntp master 3']);
    const lines = cfg(d);
    expect(shown(d, 'ntp ')).toEqual(['ntp source Loopback0', 'ntp master 3', 'ntp update-calendar', 'ntp server 10.0.0.1 prefer']);
    expect(lines.findIndex((l) => l.startsWith('line con'))).toBeGreaterThan(0);
    expect(lines.indexOf('ntp source Loopback0')).toBeGreaterThan(lines.findIndex((l) => l.startsWith('line con')));
    expect(conf(d, ['ntp master 0', 'ntp master 16']).map((r) => r.status)).toEqual(['error', 'error']);
    ok(d, ['no ntp master', 'no ntp source', 'no ntp update-calendar']);
    expect(shown(d, 'ntp ')).toEqual(['ntp server 10.0.0.1 prefer']);
    expect(d.execute('ntp ?').output).toMatch(/master\s+Act as NTP master clock[\s\S]*update-calendar\s+Periodically update calendar with NTP time/);
  });

  it('ntp update-calendar n’existe pas sur un 2960 (pas d’horloge matérielle)', () => {
    const d = sw();
    expect(conf(d, ['ntp update-calendar'])[0]?.status).toBe('error');
    ok(d, ['ntp master 4', 'ntp source vlan 1']);
  });

  it('clock timezone : heures signées, minutes toujours affichées', () => {
    const d = router();
    ok(d, ['clock timezone CET 1']);
    expect(shown(d, 'clock ')).toEqual(['clock timezone CET 1 0']);
    ok(d, ['clock timezone EST -5 30']);
    expect(shown(d, 'clock ')).toEqual(['clock timezone EST -5 30']);
    ok(d, ['clock timezone PST -8']);
    expect(shown(d, 'clock ')).toEqual(['clock timezone PST -8 0']);
    expect(conf(d, ['clock timezone X 24', 'clock timezone X -24', 'clock timezone X 1 60']).map((r) => r.status)).toEqual(['error', 'error', 'error']);
    ok(d, ['no clock timezone']);
    expect(shown(d, 'clock ')).toEqual([]);
    const help = d.execute('clock timezone CET ?').output;
    expect(help).toBe('  <-23-23>  Hours offset from UTC');
    expect(d.execute('clock timezone CET 1 ?').output).toBe('  <0-59>  Minutes offset from UTC\n  <cr>');
  });

  it('clock timezone se place après aaa, avant la configuration IP', () => {
    const d = router();
    ok(d, ['ip domain-name lab.local', 'clock timezone CET 1', 'aaa new-model', 'enable secret cisco']);
    const lines = cfg(d);
    const at = (l: string) => lines.findIndex((x) => x.startsWith(l));
    expect(at('enable secret')).toBeLessThan(at('aaa new-model'));
    expect(at('aaa new-model')).toBeLessThan(at('clock timezone'));
    expect(at('clock timezone')).toBeLessThan(at('ip domain'));
  });

  it('show ntp associations et show ntp status : sortie non simulée', () => {
    const d = router();
    d.execute('enable');
    for (const c of ['show ntp associations', 'sh ntp assoc detail', 'show ntp status']) {
      const r = d.execute(c);
      expect(r.status).toBe('ok');
      expect(r.output).toContain('Sortie non simulée');
    }
    expect(d.execute('show ntp ?').output).toBe('  associations  NTP associations\n  status        NTP status');
  });
});

describe('4.4 SNMP', () => {
  it('snmp-server community : RO/RW en majuscules, liste d’accès, une ligne par communauté', () => {
    const d = router();
    ok(d, ['snmp-server community public ro', 'snmp-server community Secret rw 10', 'snmp-server community public rw', 'snmp-server community admin RO SNMP-ACL']);
    expect(shown(d, 'snmp-server community')).toEqual(['snmp-server community public RW', 'snmp-server community Secret RW 10', 'snmp-server community admin RO SNMP-ACL']);
    expect(d.linesOf()).toContain('snmp-server community public rw');
    ok(d, ['no snmp-server community public']);
    expect(shown(d, 'snmp-server community')).toEqual(['snmp-server community Secret RW 10', 'snmp-server community admin RO SNMP-ACL']);
    expect(conf(d, ['snmp-server community x', 'snmp-server community x ro 100'])[0]?.output).toBe('% Incomplete command.');
    const help = d.execute('snmp-server community public ?').output;
    expect(help).toMatch(/ro\s+Read-only access with this community string\n\s+rw\s+Read-write access with this community string/);
  });

  it('snmp-server location et contact : texte libre, remplacé', () => {
    const d = router();
    ok(d, ['snmp-server location Salle serveur B2', 'snmp-server contact noc@example.fr', 'snmp-server location Baie 4']);
    expect(shown(d, 'snmp-server')).toEqual(['snmp-server location Baie 4', 'snmp-server contact noc@example.fr']);
    ok(d, ['no snmp-server location', 'no snmp-server contact']);
    expect(shown(d, 'snmp-server')).toEqual([]);
  });

  it('snmp-server host : traps est le défaut (non affiché), version 2c gardée, clé hôte + communauté', () => {
    const d = router();
    ok(d, ['snmp-server host 10.0.0.9 public', 'snmp-server host 10.0.0.9 traps version 2c public', 'snmp-server host 10.0.0.9 version 2c private', 'snmp-server host 10.0.0.10 traps public']);
    expect(shown(d, 'snmp-server host')).toEqual(['snmp-server host 10.0.0.9 version 2c public', 'snmp-server host 10.0.0.9 version 2c private', 'snmp-server host 10.0.0.10 public']);
    ok(d, ['no snmp-server host 10.0.0.9 traps version 2c private']);
    expect(shown(d, 'snmp-server host')).toEqual(['snmp-server host 10.0.0.9 version 2c public', 'snmp-server host 10.0.0.10 public']);
    expect(d.execute('snmp-server host 10.0.0.9 ?').output).toMatch(/traps\s+Send Trap messages to this host\n\s+version\s+SNMP version to use for notification messages\n\s+WORD\s+SNMPv1\/v2c community string or SNMPv3 user name/);
  });

  it('snmp-server enable traps : snmp seul déplié comme IOS', () => {
    const d = router();
    ok(d, ['snmp-server enable traps snmp', 'snmp-server enable traps config', 'snmp-server enable traps syslog']);
    expect(shown(d, 'snmp-server enable')).toEqual([
      'snmp-server enable traps snmp authentication linkdown linkup coldstart warmstart',
      'snmp-server enable traps config',
      'snmp-server enable traps syslog',
    ]);
    ok(d, ['snmp-server enable traps snmp linkdown linkup', 'no snmp-server enable traps config']);
    expect(shown(d, 'snmp-server enable')).toEqual(['snmp-server enable traps snmp linkdown linkup', 'snmp-server enable traps syslog']);
  });

  it('snmp-server group … v3 {noauth|auth|priv}', () => {
    const d = router();
    ok(d, ['snmp-server group ADMINS v3 priv', 'snmp-server group LECTURE v3 auth']);
    expect(shown(d, 'snmp-server group')).toEqual(['snmp-server group ADMINS v3 priv', 'snmp-server group LECTURE v3 auth']);
    expect(conf(d, ['snmp-server group X v3'])[0]?.output).toBe('% Incomplete command.');
    expect(d.execute('snmp-server group X v3 ?').output).toBe(
      '  auth    group using the authNoPriv Security Level\n  noauth  group using the noAuthNoPriv Security Level\n  priv    group using SNMPv3 authPriv security level',
    );
  });

  it('ordre IOS : group, community, location, contact, enable traps, host, après les ACL et avant les lignes', () => {
    const d = router();
    ok(d, ['snmp-server host 10.0.0.9 version 2c public', 'snmp-server enable traps snmp', 'snmp-server contact noc', 'snmp-server location B2', 'snmp-server community public ro', 'snmp-server group G v3 priv', 'access-list 10 permit any', 'banner motd #Acces reserve#', 'line console 0']);
    const lines = cfg(d);
    const at = (l: string) => lines.findIndex((x) => x.startsWith(l));
    const order = ['access-list 10', 'snmp-server group', 'snmp-server community', 'snmp-server location', 'snmp-server contact', 'snmp-server enable', 'snmp-server host', 'banner motd', 'line con'];
    const positions = order.map(at);
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});

describe('4.5 Syslog', () => {
  it('logging trap : le niveau numérique est enregistré sous son mot-clé', () => {
    const d = router();
    ok(d, ['logging trap 4']);
    expect(shown(d, 'logging')).toEqual(['logging trap warnings']);
    expect(d.history.at(-1)?.canonical).toBe('logging trap warnings');
    const names = ['emergencies', 'alerts', 'critical', 'errors', 'warnings', 'notifications', 'informational', 'debugging'];
    names.forEach((name, n) => {
      ok(d, [`logging trap ${n}`]);
      expect(shown(d, 'logging trap')).toEqual(n === 6 ? [] : [`logging trap ${name}`]);
    });
    ok(d, ['logging trap notifications', 'logging trap informational']);
    expect(shown(d, 'logging trap')).toEqual([]);
    ok(d, ['logging trap 2', 'no logging trap']);
    expect(shown(d, 'logging trap')).toEqual([]);
    expect(conf(d, ['logging trap 8'])[0]?.status).toBe('error');
  });

  it('aide ? des niveaux de gravité', () => {
    const d = router();
    conf(d, []);
    const help = d.execute('logging trap ?').output.split('\n');
    expect(help).toContain('  warnings       Warning conditions                (severity=4)');
    expect(help).toContain('  notifications  Normal but significant conditions (severity=5)');
    expect(help).toContain('  <0-7>          Logging severity level');
    expect(help.at(-1)).toBe('  <cr>');
  });

  it('logging buffered [taille] [niveau]', () => {
    const d = router();
    ok(d, ['logging buffered 16384 6']);
    expect(shown(d, 'logging')).toEqual(['logging buffered 16384 informational']);
    ok(d, ['logging buffered 3']);
    expect(shown(d, 'logging')).toEqual(['logging buffered errors']);
    ok(d, ['logging buffered 4096']);
    expect(shown(d, 'logging')).toEqual(['logging buffered 4096']);
    expect(conf(d, ['logging buffered 4095', 'logging buffered 2147483648']).map((r) => r.status)).toEqual(['error', 'error']);
    ok(d, ['no logging buffered']);
    expect(shown(d, 'logging')).toEqual([]);
  });

  it('logging console / monitor : no affiché, niveau enregistré sous son mot-clé, debugging par défaut', () => {
    const d = router();
    ok(d, ['logging console 3', 'logging monitor informational']);
    expect(shown(d, 'logging')).toEqual(['logging console errors', 'logging monitor informational']);
    ok(d, ['no logging console', 'no logging monitor 6']);
    expect(shown(d, 'logging', 'no logging')).toEqual(['no logging console', 'no logging monitor']);
    ok(d, ['logging console warnings', 'logging monitor']);
    expect(shown(d, 'logging', 'no logging')).toEqual(['logging console warnings']);
    ok(d, ['logging console debugging']);
    expect(shown(d, 'logging', 'no logging')).toEqual([]);
  });

  it('logging source-interface, logging host et la forme courte logging <ip>', () => {
    const d = router();
    ok(d, ['logging 10.0.0.50', 'logging host 10.0.0.51', 'logging source-interface g0/1', 'logging source-interface loopback 0', 'logging trap debugging']);
    expect(shown(d, 'logging')).toEqual(['logging trap debugging', 'logging source-interface Loopback0', 'logging host 10.0.0.50', 'logging host 10.0.0.51']);
    ok(d, ['no logging 10.0.0.50', 'no logging source-interface']);
    expect(shown(d, 'logging')).toEqual(['logging trap debugging', 'logging host 10.0.0.51']);
  });

  it('ordre : buffered et console après hostname, trap et host avant les ACL numérotées', () => {
    const d = router();
    ok(d, ['access-list 1 permit any', 'logging host 10.0.0.5', 'logging trap 5', 'no logging console', 'logging buffered 8192', 'enable secret cisco', 'service password-encryption', 'service timestamps log datetime msec']);
    const lines = cfg(d);
    const at = (l: string) => lines.findIndex((x) => x.startsWith(l));
    const order = ['service timestamps', 'service password-encryption', 'hostname', 'logging buffered', 'no logging console', 'enable secret', 'logging trap', 'logging host', 'access-list 1'];
    const positions = order.map(at);
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('service timestamps log datetime [msec] [localtime] [show-timezone] [year]', () => {
    const d = router();
    ok(d, ['service timestamps log datetime msec', 'service timestamps debug datetime msec localtime', 'service timestamps log datetime msec localtime show-timezone']);
    expect(shown(d, 'service timestamps')).toEqual(['service timestamps debug datetime msec localtime', 'service timestamps log datetime msec localtime show-timezone']);
    ok(d, ['service timestamps log uptime']);
    expect(shown(d, 'service timestamps log')).toEqual(['service timestamps log uptime']);
    ok(d, ['no service timestamps log']);
    expect(shown(d, 'service timestamps log')).toEqual([]);
    expect(d.execute('service timestamps log datetime ?').output).toBe(
      '  localtime      Use local time zone for timestamps\n  msec           Include milliseconds in timestamp\n  show-timezone  Add time zone information to timestamp\n  year           Include year in timestamp\n  <cr>',
    );
    ok(d, ['service timestamps log datetime msec localtime show-timezone year']);
    expect(shown(d, 'service timestamps log')).toEqual(['service timestamps log datetime msec localtime show-timezone year']);
  });

  it('terminal monitor : en mode privilégié seulement, rien n’est enregistré', () => {
    const d = router();
    expect(d.execute('terminal monitor').status).toBe('error');
    d.execute('enable');
    expect(d.execute('terminal monitor').status).toBe('ok');
    expect(d.execute('terminal no monitor').status).toBe('ok');
    expect(d.execute('terminal ?').output).toMatch(/monitor\s+Copy debug output to the current terminal line/);
    expect(cfg(d).some((l) => l.includes('monitor'))).toBe(false);
  });
});

describe('5.8 AAA et RADIUS', () => {
  it('aaa authentication login exige aaa new-model, refusée sous le mot authentication', () => {
    const d = router();
    const r = conf(d, ['aaa authentication login default local']);
    expect(r[0]?.status).toBe('error');
    expect(r[0]?.output).toBe(invalidAt('R1(config)#', 'aaa '));
    ok(d, ['aaa new-model', 'aaa authentication login default group radius local', 'aaa authentication login CONSOLE line', 'aaa authentication login default local']);
    // Une nouvelle liste du même nom remplace l'ancienne, à sa place.
    expect(shown(d, 'aaa')).toEqual(['aaa new-model', 'aaa authentication login default local', 'aaa authentication login CONSOLE line']);
    ok(d, ['no aaa authentication login default']);
    expect(shown(d, 'aaa')).toEqual(['aaa new-model', 'aaa authentication login CONSOLE line']);
  });

  it('une à quatre méthodes : local, local-case, enable, line, none, group radius|tacacs+|<nom>', () => {
    const d = router();
    ok(d, ['aaa new-model', 'aaa authentication login VTY group tacacs+ group ISE local-case enable', 'aaa authentication login default group radius none']);
    expect(shown(d, 'aaa authentication')).toEqual(['aaa authentication login VTY group tacacs+ group ISE local-case enable', 'aaa authentication login default group radius none']);
    expect(conf(d, ['aaa authentication login X local enable line none local'])[0]?.status).toBe('error');
    expect(conf(d, ['aaa authentication login X'])[0]?.output).toBe('% Incomplete command.');
    expect(conf(d, ['aaa authentication login X group'])[0]?.output).toBe('% Incomplete command.');
    ok(d, ['no aaa authentication login VTY']);
    expect(shown(d, 'aaa authentication')).toEqual(['aaa authentication login default group radius none']);
    const help = d.execute('aaa authentication login default ?').output;
    expect(help).toMatch(/local\s+Use local username authentication\./);
    expect(help).toMatch(/local-case\s+Use case-sensitive local username authentication\./);
    expect(d.execute('aaa authentication login default group ?').output).toBe(
      '  radius   Use list of all Radius hosts.\n  tacacs+  Use list of all Tacacs+ hosts.\n  WORD     Server-group name',
    );
  });

  it('radius server : sous-mode, ports toujours affichés (1645/1646 par défaut), clé', () => {
    const d = router();
    const r = conf(d, ['aaa new-model', 'radius server ISE', 'address ipv4 10.0.0.20', 'key Cl3Partagee']);
    expect(r[1]?.prompt).toBe('R1(config-radius-server)#');
    expect(section(d, 'radius server ISE')).toEqual(['address ipv4 10.0.0.20 auth-port 1645 acct-port 1646', 'key Cl3Partagee']);
    ok(d, ['radius server ISE', 'address ipv4 10.0.0.21 auth-port 1812 acct-port 1813']);
    expect(section(d, 'radius server ISE')).toEqual(['address ipv4 10.0.0.21 auth-port 1812 acct-port 1813', 'key Cl3Partagee']);
    ok(d, ['radius server ISE', 'address ipv4 10.0.0.21 auth-port 1812']);
    expect(section(d, 'radius server ISE')[0]).toBe('address ipv4 10.0.0.21 auth-port 1812 acct-port 1646');
    ok(d, ['radius server ISE', 'address ipv4 10.0.0.21 acct-port 1813']);
    expect(section(d, 'radius server ISE')[0]).toBe('address ipv4 10.0.0.21 auth-port 1645 acct-port 1813');
    expect(d.execute('?').output.split('\n')[0]).toBe('RADIUS server sub-mode commands:');
    expect(d.execute('exit').prompt).toBe('R1(config)#');
    ok(d, ['no radius server ISE']);
    expect(cfg(d).some((l) => l.startsWith('radius'))).toBe(false);
  });

  it('radius server se place après snmp-server, avant banner et line', () => {
    const d = router();
    ok(d, ['banner motd #X#', 'radius server ISE', 'address ipv4 10.0.0.20', 'exit', 'snmp-server community public ro']);
    const lines = cfg(d);
    const at = (l: string) => lines.findIndex((x) => x.startsWith(l));
    expect(at('snmp-server community')).toBeLessThan(at('radius server ISE'));
    expect(at('radius server ISE')).toBeLessThan(at('banner motd'));
  });

  it('login authentication sur une ligne : exige aaa new-model, default non affiché', () => {
    const d = router();
    const r = conf(d, ['line vty 0 4', 'login authentication VTY']);
    expect(r[1]?.output).toBe(invalidAt('R1(config-line)#', 'login '));
    ok(d, ['exit', 'aaa new-model', 'line vty 0 4', 'login authentication VTY', 'transport input ssh']);
    expect(section(d, 'line vty 0 4')).toEqual(['login authentication VTY', 'transport input ssh']);
    ok(d, ['login authentication default']);
    expect(section(d, 'line vty 0 4')).toEqual(['transport input ssh']);
    ok(d, ['login authentication VTY', 'no login authentication']);
    expect(section(d, 'line vty 0 4')).toEqual(['transport input ssh']);
    expect(d.execute('login authentication ?').output).toBe('  default  Use the default list.\n  WORD     Use an authentication list with this name.');
  });
});
