import { describe, expect, it } from 'vitest';
import type { AnswerKey, QuestionBody } from '../src/question.js';
import {
  answerSignature,
  compareQuestions,
  contentKey,
  DUPLICATE_THRESHOLD,
  extractValues,
  findNearDuplicates,
  SUSPECT_THRESHOLD,
  type SimilarityQuestion,
} from '../src/similarity.js';

const mcq = (id: string, stem: string, options: string[], correct = 'a', exhibit?: string): SimilarityQuestion => ({
  id,
  body: { type: 'mcq_single', stem, ...(exhibit ? { exhibit } : {}), options: options.map((text, i) => ({ id: 'abcd'[i] as string, text })) },
  key: { type: 'mcq_single', correct },
});
const blank = (id: string, stem: string, answer: string): SimilarityQuestion => ({
  id,
  body: { type: 'fill_blank', stem, fields: [{ id: 'x', label: 'Adresse en décimal pointé' }] },
  key: { type: 'fill_blank', fields: { x: { accepted: [answer], normalize: 'ipv4' } } },
});

describe('compareQuestions : le seuil de doublon', () => {
  it('une même question reformulée, mêmes valeurs et même réponse, dépasse le seuil', () => {
    const a = mcq('a', "Quelle est l'adresse de diffusion du sous-réseau qui contient l'hôte 172.16.45.130/26 ?", ['172.16.45.191', '172.16.45.255', '172.16.45.127', '172.16.45.128']);
    const b = mcq('b', "Un hôte a l'adresse 172.16.45.130/26. Quelle est l'adresse de diffusion de son sous-réseau ?", ['172.16.45.191', '172.16.45.255', '172.16.45.159', '172.16.45.128']);
    expect(compareQuestions(a, b).score).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD);
  });

  it('une question de cours reformulée, même réponse, dépasse le seuil', () => {
    const a = mcq('a', "Quelle est la distance administrative par défaut d'une route OSPF ?", ['110', '90', '120', '1']);
    const b = mcq('b', 'Par défaut, quelle distance administrative un routeur Cisco attribue-t-il aux routes apprises par OSPF ?', ['110', '100', '120', '20']);
    expect(compareQuestions(a, b).score).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD);
  });

  it('deux questions identiques ont un score de 1', () => {
    const a = blank('a', "Quelle est l'adresse réseau du sous-réseau qui contient l'hôte 10.4.77.200/27 ?", '10.4.77.192');
    expect(compareQuestions(a, { ...a, id: 'b' })).toEqual({ score: 1, text: 1, values: 1, sameAnswer: true });
  });

  it('un même gabarit sur d’autres valeurs reste un autre exercice', () => {
    const a = blank('a', "Quelle est l'adresse réseau du sous-réseau qui contient l'hôte 10.4.77.200/27 ?", '10.4.77.192');
    const b = blank('b', "Quelle est l'adresse réseau du sous-réseau qui contient l'hôte 192.168.9.45/28 ?", '192.168.9.32');
    const s = compareQuestions(a, b);
    expect(s.text).toBe(1);
    expect(s.score).toBeLessThan(SUSPECT_THRESHOLD);
  });

  it('les mêmes valeurs avec une autre question (réseau puis diffusion) restent sous le seuil', () => {
    const a = blank('a', "Quelle est l'adresse réseau du sous-réseau qui contient l'hôte 10.4.77.200/27 ?", '10.4.77.192');
    const b = blank('b', "Quelle est l'adresse de diffusion du sous-réseau qui contient l'hôte 10.4.77.200/27 ?", '10.4.77.223');
    expect(compareQuestions(a, b).score).toBeLessThan(DUPLICATE_THRESHOLD);
  });

  it('deux notions voisines du même sujet ne sont pas des doublons', () => {
    const a = mcq('a', "Quelle est la distance administrative par défaut d'une route OSPF ?", ['110', '90', '120', '1']);
    const b = mcq('b', "Quelle est la distance administrative par défaut d'une route EIGRP interne ?", ['90', '110', '170', '1']);
    expect(compareQuestions(a, b).score).toBeLessThan(SUSPECT_THRESHOLD);
  });

  it('une même réponse à deux questions différentes ne suffit pas', () => {
    const a = mcq('a', 'Quel protocole de transport utilise une poignée de main en trois temps ?', ['TCP', 'UDP', 'ICMP', 'IP']);
    const b = mcq('b', 'Quel protocole de transport retransmet les segments perdus ?', ['TCP', 'UDP', 'ARP', 'GRE']);
    const s = compareQuestions(a, b);
    expect(s.sameAnswer).toBe(true);
    expect(s.score).toBeLessThan(SUSPECT_THRESHOLD);
  });
});

describe('extractValues', () => {
  it('relève adresses, préfixes, MAC et nombres, sans prendre une heure pour une IPv6', () => {
    const v = extractValues('R1 joint 10.1.1.0/24 via 192.168.1.2, 00:12:40, Gi0/1 ; MAC 0011.2233.4455 ; 2001:db8:acad:1::/64 ; VLAN 10 ; coût 1');
    expect([...v].sort()).toEqual(['0011.2233.4455', '10', '10.1.1.0/24', '192.168.1.2', '2001:db8:acad:1::/64'].sort());
  });
});

describe('answerSignature', () => {
  const sig = (body: QuestionBody, key: AnswerKey) => answerSignature(body, key);

  it('lit la bonne réponse de chaque type, indépendamment des identifiants', () => {
    expect(sig({ type: 'mcq_multi', stem: 'Quelles deux ?', selectCount: 2, options: [{ id: 'x', text: 'B' }, { id: 'y', text: 'A' }, { id: 'z', text: 'C' }] }, { type: 'mcq_multi', correct: ['x', 'y'] })).toBe('a | b');
    expect(sig({ type: 'cli', stem: 'Configurez…', prompt: 'R1(config)#', lines: 2 }, { type: 'cli', commands: [['router ospf 1'], ['network 10.0.0.0 0.0.0.255 area 0']], ordered: true })).toBe(
      'router ospf 1 | network 10.0.0.0 0.0.0.255 area 0',
    );
    expect(sig({ type: 'ordering', stem: 'Ordonnez…', items: [{ id: '1', text: 'Discover' }, { id: '2', text: 'Offer' }] }, { type: 'ordering', order: ['1', '2'] })).toBe('discover > offer');
    expect(
      sig(
        { type: 'matching', stem: 'Associez…', left: [{ id: 'l', text: 'SSH' }], right: [{ id: 'r', text: '22' }, { id: 's', text: '23' }] },
        { type: 'matching', pairs: { l: 'r' } },
      ),
    ).toBe('ssh = 22');
  });
});

describe('contentKey', () => {
  it('ignore la casse, les espaces et l’ordre des options', () => {
    const a = mcq('a', 'Quel  port utilise SSH ?', ['22', '23', '80', '443']).body;
    const b = mcq('b', 'quel port utilise ssh ?', ['443', '80', '23', '22']).body;
    expect(contentKey(a)).toBe(contentKey(b));
    expect(contentKey(a)).not.toBe(contentKey(mcq('c', 'Quel port utilise Telnet ?', ['22', '23', '80', '443']).body));
  });
});

describe('findNearDuplicates', () => {
  const qs = [
    mcq('ospf-ad', "Quelle est la distance administrative par défaut d'une route OSPF ?", ['110', '90', '120', '1']),
    mcq('ospf-ad-bis', 'Par défaut, quelle distance administrative un routeur Cisco attribue-t-il aux routes apprises par OSPF ?', ['110', '100', '120', '20']),
    mcq('eigrp-ad', "Quelle est la distance administrative par défaut d'une route EIGRP interne ?", ['90', '110', '170', '1']),
    mcq('ssh', 'Quel port TCP utilise SSH ?', ['22', '23', '80', '443']),
  ];

  it('trouve la paire en double et elle seule au seuil de doublon', () => {
    const pairs = findNearDuplicates(qs, { threshold: DUPLICATE_THRESHOLD });
    expect(pairs.map((p) => [p.a, p.b])).toEqual([['ospf-ad', 'ospf-ad-bis']]);
  });

  it('ne compare qu’un lot face au reste avec `only`', () => {
    expect(findNearDuplicates(qs, { threshold: DUPLICATE_THRESHOLD, only: new Set(['ssh']) })).toEqual([]);
    expect(findNearDuplicates(qs, { threshold: DUPLICATE_THRESHOLD, only: new Set(['ospf-ad-bis']) })).toHaveLength(1);
  });

  it('classe les paires de la plus proche à la moins proche', () => {
    const pairs = findNearDuplicates(qs, { threshold: 0.2 });
    expect(pairs.length).toBeGreaterThan(1);
    for (let i = 1; i < pairs.length; i++) expect(pairs[i - 1]!.score).toBeGreaterThanOrEqual(pairs[i]!.score);
  });
});
