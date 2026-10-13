import { describe, expect, it } from 'vitest';
import { grade } from '../src/grading.js';
import { checkQuestionConsistency, parseQuestion, type AnswerKey } from '../src/question.js';
import { toPublicBody } from '../src/public.js';

describe('grade', () => {
  it('QCM simple', () => {
    const key: AnswerKey = { type: 'mcq_single', correct: 'b' };
    expect(grade(key, { type: 'mcq_single', choice: 'b' })).toEqual({ correct: true, partial: 1 });
    expect(grade(key, { type: 'mcq_single', choice: 'a' }).correct).toBe(false);
    expect(grade(key, null).correct).toBe(false);
  });

  it('QCM multiple : tout ou rien, et cocher trop de cases ne paie pas', () => {
    const key: AnswerKey = { type: 'mcq_multi', correct: ['a', 'b'] };
    expect(grade(key, { type: 'mcq_multi', choices: ['b', 'a'] })).toEqual({ correct: true, partial: 1 });
    expect(grade(key, { type: 'mcq_multi', choices: ['a', 'c'] })).toEqual({ correct: false, partial: 0.5 });
    expect(grade(key, { type: 'mcq_multi', choices: ['a', 'b', 'c'] })).toEqual({ correct: false, partial: 0 });
  });

  it('champs à compléter avec normalisation IPv4 et entiers', () => {
    const key: AnswerKey = {
      type: 'fill_blank',
      fields: {
        net: { accepted: ['172.16.45.128'], normalize: 'ipv4' },
        hosts: { accepted: ['62'], normalize: 'int' },
      },
    };
    expect(grade(key, { type: 'fill_blank', fields: { net: ' 172.16.045.128', hosts: '062' } }).correct).toBe(true);
    expect(grade(key, { type: 'fill_blank', fields: { net: '172.16.45.192', hosts: '62' } })).toEqual({
      correct: false,
      partial: 0.5,
    });
  });

  it('CLI ordonné, avec abréviations', () => {
    const key: AnswerKey = {
      type: 'cli',
      ordered: true,
      commands: [['interface gigabitethernet0/0/0'], ['ip access-group BLOCK-WEB in']],
    };
    expect(grade(key, { type: 'cli', lines: ['int g0/0/0', 'ip access-g BLOCK-WEB in'] }).correct).toBe(true);
    expect(grade(key, { type: 'cli', lines: ['ip access-group BLOCK-WEB in', 'int g0/0/0'] }).correct).toBe(false);
    expect(grade(key, { type: 'cli', lines: ['int g0/0/0', 'ip access-group BLOCK-WEB in', 'end'] }).correct).toBe(false);
  });

  it('CLI sans ordre imposé', () => {
    const key: AnswerKey = {
      type: 'cli',
      ordered: false,
      commands: [['switchport mode access'], ['switchport access vlan 10']],
    };
    expect(grade(key, { type: 'cli', lines: ['sw acc vlan 10', 'switchport mode access'] }).correct).toBe(true);
  });

  it('ordre et association', () => {
    expect(grade({ type: 'ordering', order: ['a', 'b', 'c'] }, { type: 'ordering', order: ['a', 'b', 'c'] }).correct).toBe(true);
    expect(grade({ type: 'ordering', order: ['a', 'b', 'c'] }, { type: 'ordering', order: ['a', 'c', 'b'] }).partial).toBeCloseTo(1 / 3);
    expect(
      grade({ type: 'matching', pairs: { x: '1', y: '2' } }, { type: 'matching', pairs: { x: '1', y: '1' } }),
    ).toEqual({ correct: false, partial: 0.5 });
  });

  it('une réponse du mauvais type est fausse', () => {
    expect(grade({ type: 'mcq_single', correct: 'a' }, { type: 'ordering', order: ['a'] }).correct).toBe(false);
  });
});

describe('cohérence des questions', () => {
  const base = {
    slug: 'ccna-3.4-ospf-001',
    certification: 'ccna',
    domain: '3.0',
    difficulty: 'medium',
    explanation: 'Les voisins OSPF doivent partager area et timers.',
  };

  it('accepte une question valide', () => {
    const q = parseQuestion({
      ...base,
      body: {
        type: 'mcq_multi',
        stem: 'Quelles deux actions rétablissent l\'adjacence ?',
        selectCount: 2,
        options: [
          { id: 'a', text: 'Area 0' },
          { id: 'b', text: 'Timers 10/40' },
          { id: 'c', text: 'Process ID' },
        ],
      },
      key: { type: 'mcq_multi', correct: ['a', 'b'] },
    });
    expect(q.distractorNotes).toEqual({});
  });

  it('détecte une correction incohérente', () => {
    expect(
      checkQuestionConsistency({
        body: {
          type: 'mcq_multi',
          stem: 'Choisissez deux réponses correctes.',
          selectCount: 2,
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'a' },
            { id: 'c', text: 'C' },
          ],
        },
        key: { type: 'mcq_multi', correct: ['a', 'z', 'c'] },
      }),
    ).toEqual(['deux options ont le même texte', 'réponse z absente des options', 'selectCount=2 mais 3 bonnes réponses', 'aucun distracteur']);
  });

  it('mélange l\'affichage de façon stable', () => {
    const body = {
      type: 'ordering' as const,
      stem: 'Remettez les étapes DHCP dans l\'ordre.',
      items: ['discover', 'offer', 'request', 'ack'].map((id) => ({ id, text: id })),
    };
    expect(toPublicBody(body, 42)).toEqual(toPublicBody(body, 42));
    expect(toPublicBody(body, 42)).not.toHaveProperty('key');
  });
});
