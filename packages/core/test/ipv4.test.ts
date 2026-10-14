import { describe, expect, it } from 'vitest';
import { analyzeIpv4, maskToPrefix, normalizeIpv4, parseIpv4, prefixToMask } from '../src/ipv4.js';
import { generateSubnetExercise, planVlsm, prefixForHosts } from '../src/subnetting.js';

describe('ipv4', () => {
  it('calcule un /26 classique', () => {
    expect(analyzeIpv4('172.16.45.130', 26)).toMatchObject({
      mask: '255.255.255.192',
      wildcard: '0.0.0.63',
      network: '172.16.45.128',
      broadcast: '172.16.45.191',
      firstHost: '172.16.45.129',
      lastHost: '172.16.45.190',
      usableHosts: 62,
      blockSize: 64,
    });
  });

  it('gère un masque dans le troisième octet', () => {
    expect(analyzeIpv4('172.20.130.9', 18)).toMatchObject({
      network: '172.20.128.0',
      broadcast: '172.20.191.255',
      usableHosts: 16382,
    });
  });

  it('applique la RFC 3021 aux /31 et un seul hôte aux /32', () => {
    expect(analyzeIpv4('10.0.0.1', 31)).toMatchObject({ firstHost: '10.0.0.0', lastHost: '10.0.0.1', usableHosts: 2 });
    expect(analyzeIpv4('10.0.0.1', 32)).toMatchObject({ network: '10.0.0.1', usableHosts: 1 });
  });

  it('refuse les adresses invalides', () => {
    expect(parseIpv4('256.1.1.1')).toBeNull();
    expect(parseIpv4('1.1.1')).toBeNull();
    expect(parseIpv4('a.b.c.d')).toBeNull();
    expect(() => analyzeIpv4('10.0.0.1', 33)).toThrow();
  });

  it('convertit masques et préfixes', () => {
    expect(prefixToMask(0)).toBe(0);
    expect(maskToPrefix(prefixToMask(23))).toBe(23);
    expect(maskToPrefix(parseIpv4('255.0.255.0') as number)).toBeNull();
    expect(normalizeIpv4(' 010.001.1.1 ')).toBe('10.1.1.1');
  });
});

describe('subnetting', () => {
  it('produit des exercices reproductibles et cohérents', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const ex = generateSubnetExercise(seed, { minPrefix: 16, maxPrefix: 30 });
      expect(generateSubnetExercise(seed, { minPrefix: 16, maxPrefix: 30 })).toEqual(ex);
      expect(ex.prefix).toBeGreaterThanOrEqual(16);
      expect(ex.prefix).toBeLessThanOrEqual(30);
      expect(ex.address).not.toBe(ex.answer.network);
      expect(ex.address).not.toBe(ex.answer.broadcast);
      expect(ex.answer).toEqual(analyzeIpv4(ex.address, ex.prefix));
    }
  });

  it('choisit le plus petit préfixe suffisant', () => {
    expect(prefixForHosts(2)).toBe(30);
    expect(prefixForHosts(62)).toBe(26);
    expect(prefixForHosts(63)).toBe(25);
    expect(prefixForHosts(500)).toBe(23);
  });

  it('construit un plan VLSM sans chevauchement', () => {
    const plan = planVlsm('192.168.10.0', 24, [
      { name: 'WAN', hosts: 2 },
      { name: 'Users', hosts: 100 },
      { name: 'Servers', hosts: 25 },
      { name: 'Mgmt', hosts: 10 },
    ]);
    expect(plan.map((p) => `${p.name} ${p.network}/${p.prefix}`)).toEqual([
      'Users 192.168.10.0/25',
      'Servers 192.168.10.128/27',
      'Mgmt 192.168.10.160/28',
      'WAN 192.168.10.176/30',
    ]);
    expect(() => planVlsm('192.168.10.0', 26, [{ name: 'Users', hosts: 100 }])).toThrow();
  });
});
