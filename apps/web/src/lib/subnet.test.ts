import { analyzeIpv4, generateSubnetExercise } from '@examforge/core';
import { describe, expect, it } from 'vitest';
import { checkAll, checkField, incrementIp, interestingOctet, octetBreakdown } from './subnet';

const ex = analyzeIpv4('172.16.45.130', 26);

describe('checkField', () => {
  it('accepte les formes équivalentes', () => {
    expect(checkField(ex, 'network', ' 172.16.045.128 ').ok).toBe(true);
    expect(checkField(ex, 'usableHosts', '62').ok).toBe(true);
  });
  it('explique les erreurs classiques', () => {
    expect(checkField(ex, 'broadcast', '172.16.45.192').hint).toBe('172.16.45.192 est le réseau suivant → attendu 172.16.45.191');
    expect(checkField(ex, 'firstHost', '172.16.45.128').hint).toContain("l'adresse réseau");
    expect(checkField(ex, 'usableHosts', '64').hint).toContain('taille du bloc');
    expect(checkField(ex, 'mask', '').hint).toBe('champ vide → attendu 255.255.255.192');
  });
  it('corrige tous les champs', () => {
    const r = checkAll(ex, {
      network: '172.16.45.128',
      mask: '255.255.255.192',
      broadcast: '172.16.45.191',
      usableHosts: '62',
      firstHost: '172.16.45.129',
      lastHost: '172.16.45.190',
    });
    expect(Object.values(r).every((c) => c.ok)).toBe(true);
  });
});

describe('octetBreakdown', () => {
  it('décompose le 4ᵉ octet d’un /26', () => {
    const b = octetBreakdown(ex);
    expect(b.index).toBe(3);
    expect(b.addressBits).toEqual([1, 0, 0, 0, 0, 0, 1, 0]);
    expect(b.maskBits).toEqual([1, 1, 0, 0, 0, 0, 0, 0]);
    expect(b.blockSize).toBe(64);
    expect(b.starts).toEqual([0, 64, 128, 192]);
    expect(b.currentStart).toBe(128);
  });
  it('abrège la liste des blocs quand ils sont nombreux', () => {
    const b = octetBreakdown(analyzeIpv4('10.1.2.77', 29));
    expect(b.truncated).toBe(true);
    expect(b.starts).toEqual([56, 64, 72, 80, 88]);
  });
  it('octet intéressant selon le préfixe', () => {
    expect(interestingOctet(8)).toBe(0);
    expect(interestingOctet(24)).toBe(2);
    expect(interestingOctet(26)).toBe(3);
    expect(interestingOctet(20)).toBe(2);
    expect(interestingOctet(32)).toBe(3);
  });
  it('fonctionne sur les exercices générés', () => {
    for (let seed = 1; seed < 50; seed++) {
      const { answer } = generateSubnetExercise(seed);
      const b = octetBreakdown(answer);
      expect(b.starts).toContain(b.currentStart);
    }
  });
  it('préfixe multiple de 8 : pas de bloc 1 sur le dernier octet plein', () => {
    const b = octetBreakdown(analyzeIpv4('192.168.40.181', 8));
    expect(b.index).toBe(0);
    expect(b.blockSize).toBe(1);
    expect(b.currentStart).toBe(192);
    expect(b.starts).toEqual([190, 191, 192, 193, 194]);
  });
  it('incrémente une adresse', () => {
    expect(incrementIp('10.0.0.255')).toBe('10.0.1.0');
  });
});
