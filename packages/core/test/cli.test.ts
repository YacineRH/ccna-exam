import { describe, expect, it } from 'vitest';
import { commandMatches, normalizeCommand } from '../src/cli.js';

describe('normalizeCommand', () => {
  it.each([
    ['conf t', 'configure terminal'],
    ['int g0/0', 'interface gigabitethernet0/0'],
    ['interface Gi 0/0/1', 'interface gigabitethernet0/0/1'],
    ['sh ip int br', 'show ip interface brief'],
    ['no shut', 'no shutdown'],
    ['ip add 10.0.0.1 255.255.255.0', 'ip address 10.0.0.1 255.255.255.0'],
    ['ip access-group BLOCK-WEB in', 'ip access-group block-web in'],
    ['deny tcp 192.168.10.0 0.0.0.255 host 10.1.1.80 eq www', 'deny tcp 192.168.10.0 0.0.0.255 host 10.1.1.80 eq 80'],
    ['   switchport   mode   access  ', 'switchport mode access'],
    ['passive-interface fa0/1', 'passive-interface fastethernet0/1'],
    ['int range fa0/1 - 5', 'interface range fastethernet0/1 - 5'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeCommand(input)).toBe(expected);
  });

  it('ne prend pas un nom d\'équipement pour une interface', () => {
    expect(normalizeCommand('hostname S1')).toBe('hostname s1');
  });

  it('reconnaît un nom d\'interface avec « / » hors du mot-clé interface', () => {
    expect(normalizeCommand('ip route 0.0.0.0 0.0.0.0 g0/0')).toBe('ip route 0.0.0.0 0.0.0.0 gigabitethernet0/0');
    expect(commandMatches('ipv6 route ::/0 Gi0/0/1 fe80::2', ['ipv6 route ::/0 GigabitEthernet0/0/1 FE80::2'])).toBe(true);
    // Les préfixes IPv6 et les adresses ne sont pas pris pour des interfaces.
    expect(normalizeCommand('ipv6 address 2001:db8:acad:10::/64 eui-64')).toBe('ipv6 address 2001:db8:acad:10::/64 eui-64');
  });

  it('ne développe pas un préfixe ambigu', () => {
    // "s" pourrait être show, shutdown, speed, ssh... : IOS répond "Ambiguous command".
    expect(normalizeCommand('s run')).toBe('s running-config');
    expect(commandMatches('s run', ['show running-config'])).toBe(false);
  });

  it('compare deux écritures équivalentes', () => {
    expect(commandMatches('router ospf 1', ['router ospf 1'])).toBe(true);
    expect(commandMatches('network 10.0.12.0 0.0.0.3 area 0', ['network 10.0.12.0 0.0.0.3 area 0'])).toBe(true);
    expect(commandMatches('network 10.0.12.0 0.0.0.3 area 1', ['network 10.0.12.0 0.0.0.3 area 0'])).toBe(false);
  });

  it('lit les plages et les listes d\'interfaces quel que soit l\'espacement', () => {
    const accepted = ['interface range GigabitEthernet1/0/1 - 2'];
    expect(commandMatches('int range g1/0/1-2', accepted)).toBe(true);
    expect(commandMatches('int ra gi1/0/1 -2', accepted)).toBe(true);
    expect(commandMatches('int range g1/0/1,g1/0/2', ['interface range GigabitEthernet1/0/1 , GigabitEthernet1/0/2'])).toBe(true);
    expect(commandMatches('sw tr allowed vlan 10,20', ['switchport trunk allowed vlan 10, 20'])).toBe(true);
    expect(commandMatches('int range g1/0/1-3', accepted)).toBe(false);
  });

  it('accepte un nom d\'interface séparé de son numéro, hors du mot-clé interface', () => {
    expect(commandMatches('ipv6 route 2001:db8:cafe:20::/64 GigabitEthernet 0/1 fe80::2', ['ipv6 route 2001:db8:cafe:20::/64 Gi0/1 FE80::2'])).toBe(true);
    expect(normalizeCommand('network 10.1.1.0 0.0.0.255 area 0')).toBe('network 10.1.1.0 0.0.0.255 area 0');
    expect(normalizeCommand('spanning-tree vlan 10 priority 4096')).toBe('spanning-tree vlan 10 priority 4096');
  });

  it('ramène les adresses IPv6 à la forme canonique', () => {
    expect(commandMatches('ipv6 address 2001:0DB8:ACAD:0010:0000::/64 eui-64', ['ipv6 address 2001:db8:acad:10::/64 eui-64'])).toBe(true);
    expect(commandMatches('ipv6 route ::/0 2001:db8::0:1', ['ipv6 route ::/0 2001:DB8::1'])).toBe(true);
    expect(commandMatches('ipv6 route ::/0 2001:db8::2', ['ipv6 route ::/0 2001:db8::1'])).toBe(false);
    // Une heure n'est pas une adresse IPv6.
    expect(normalizeCommand('clock set 10:00:00 7 Nov 2026')).toBe('clock set 10:00:00 7 nov 2026');
  });

  it('développe les abréviations usuelles des mots-clés de commutation, OSPF, HSRP et sécurité', () => {
    expect(commandMatches('sw mo tr', ['switchport mode trunk'])).toBe(true);
    expect(commandMatches('sw tr all vl add 30', ['switchport trunk allowed vlan add 30'])).toBe(true);
    expect(commandMatches('sw voi vl 150', ['switchport voice vlan 150'])).toBe(true);
    expect(commandMatches('span bpdug en', ['spanning-tree bpduguard enable'])).toBe(true);
    expect(commandMatches('span vl 10 root pri', ['spanning-tree vlan 10 root primary'])).toBe(true);
    expect(commandMatches('stan 10 pree', ['standby 10 preempt'])).toBe(true);
    expect(commandMatches('ip ospf net point', ['ip ospf network point-to-point'])).toBe(true);
    expect(commandMatches('line con 0', ['line console 0'])).toBe(true);
    expect(commandMatches('transport in ssh', ['transport input ssh'])).toBe(true);
    expect(commandMatches('ip dh snoop tru', ['ip dhcp snooping trust'])).toBe(true);
    expect(commandMatches('ip nat ins so li 1 int g0/1 ov', ['ip nat inside source list 1 interface GigabitEthernet0/1 overload'])).toBe(true);
    expect(commandMatches('cry key gen rsa mod 2048', ['crypto key generate rsa modulus 2048'])).toBe(true);
    expect(commandMatches('standby 10 pri 110', ['standby 10 priority 110'])).toBe(true);
    expect(commandMatches('net 10.1.12.0 0.0.0.3 ar 0', ['network 10.1.12.0 0.0.0.3 area 0'])).toBe(true);
    // Toujours ambigu, comme dans IOS : "pr" (preempt, priority).
    expect(normalizeCommand('standby 10 pr')).toBe('standby 10 pr');
  });
});
