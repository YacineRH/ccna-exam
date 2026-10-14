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
});
