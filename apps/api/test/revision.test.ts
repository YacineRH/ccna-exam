import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnswerKey, Response } from '@examforge/core';
import { buildApp } from '../src/app.js';
import { createDb, type Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { questions, reviewCards, users } from '../src/db/schema.js';
import { seedContent } from '../src/db/seed.js';
import { loadEnv } from '../src/env.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;

/** Bonne réponse tirée de la correction (QCM simple), ou réponse fausse du bon type. */
function responseFor(key: AnswerKey, right: boolean): Response {
  switch (key.type) {
    case 'mcq_single':
      return { type: 'mcq_single', choice: right ? key.correct : 'zzz' };
    case 'mcq_multi':
      return { type: 'mcq_multi', choices: right ? key.correct : [] };
    case 'fill_blank':
      return { type: 'fill_blank', fields: {} };
    case 'cli':
      return { type: 'cli', lines: [] };
    default:
      throw new Error(`type inattendu ${key.type}`);
  }
}

describe.skipIf(!DATABASE_URL)('API v1 : révision espacée (PostgreSQL)', () => {
  let app: FastifyInstance;
  let db: Db;
  let pool: pg.Pool;
  let cookie = '';
  let otherCookie = '';
  let otherId = '';
  let userId = '';

  const call = async (method: 'GET' | 'POST', url: string, body?: unknown, as = cookie) =>
    app.inject({ method, url: `/api/v1${url}`, payload: body as object, headers: as ? { cookie: as } : {} });

  beforeAll(async () => {
    ({ db, pool } = createDb(DATABASE_URL!));
    await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
    await runMigrations(db);
    await seedContent(db);
    const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: DATABASE_URL!, JWT_SECRET: 'x'.repeat(40), SERVICE_TOKEN: 's'.repeat(40) });
    app = await buildApp(env, db);
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'cartes@example.com', password: 'correct-horse-battery', displayName: 'Cartes' },
    });
    cookie = `ef_session=${reg.cookies.find((x) => x.name === 'ef_session')?.value}`;
    userId = (reg.json() as { user: { id: string } }).user.id;
    const [other] = await db.insert(users).values({ email: 'autre-cartes@example.com', passwordHash: 'x', displayName: 'Autre' }).returning();
    otherId = other!.id;
    otherCookie = `ef_session=${await app.jwt.sign({ sub: otherId, role: 'user' })}`;
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  type Overview = { dueToday: number; totalCards: number; decks: { subtopic: string; available: number; enrolled: boolean; cards: number; due: number }[] };
  let deck = '';

  it('vue d’ensemble : des paquets de 10 à 20 cartes par sous-thème, rien à réviser au départ', async () => {
    const res = await call('GET', '/revision?certification=ccna');
    expect(res.statusCode).toBe(200);
    const o = res.json() as Overview;
    expect(o.dueToday).toBe(0);
    expect(o.decks.length).toBeGreaterThan(5);
    for (const d of o.decks) expect(d.available).toBeLessThanOrEqual(20);
    const big = o.decks.find((d) => d.available >= 10);
    expect(big).toBeDefined();
    deck = big!.subtopic;
    expect((await call('GET', '/revision?certification=ccna', undefined, '')).statusCode).toBe(401);
  });

  it('ajouter un paquet rend ses cartes dues aujourd’hui ; un second ajout ne change rien', async () => {
    const res = await call('POST', '/revision/decks', { certification: 'ccna', subtopic: deck });
    expect(res.statusCode).toBe(201);
    const added = res.json() as { added: number; cards: number };
    expect(added.added).toBe(added.cards);
    expect(added.cards).toBeGreaterThanOrEqual(10);
    const again = (await call('POST', '/revision/decks', { certification: 'ccna', subtopic: deck })).json() as { added: number };
    expect(again.added).toBe(0);
    const o = (await call('GET', '/revision?certification=ccna')).json() as Overview;
    expect(o.dueToday).toBe(added.cards);
    expect(o.decks.find((d) => d.subtopic === deck)).toMatchObject({ enrolled: true, due: added.cards });
  });

  it('isolement : les cartes d’un utilisateur ne sont pas celles d’un autre', async () => {
    const o = (await call('GET', '/revision?certification=ccna', undefined, otherCookie)).json() as Overview;
    expect(o.dueToday).toBe(0);
    expect(o.totalCards).toBe(0);
    const none = await call('POST', '/revision/sessions', { certification: 'ccna' }, otherCookie);
    expect(none.statusCode).toBe(409);
  });

  let sessionId = '';
  let cards: { questionId: string; answer: unknown }[] = [];
  it('une session tire les cartes dues, sans correction avant la réponse', async () => {
    const res = await call('POST', '/revision/sessions', { certification: 'ccna' });
    expect(res.statusCode).toBe(201);
    const s = res.json() as { id: string; total: number; cards: { questionId: string; answer: unknown; body: unknown }[] };
    sessionId = s.id;
    cards = s.cards;
    expect(s.total).toBeGreaterThanOrEqual(10);
    expect(cards.every((c) => c.answer === null)).toBe(true);
    expect(res.body).not.toContain('"explanation"');
    expect(res.body).not.toContain('answer_key');
    expect(res.body).not.toContain('"correct"');
  });

  it('un autre utilisateur ne peut ni lire ni répondre à la session', async () => {
    expect((await call('GET', `/revision/sessions/${sessionId}`, undefined, otherCookie)).statusCode).toBe(403);
    const r = await call('POST', `/revision/sessions/${sessionId}/answers`, { questionId: cards[0]!.questionId, response: { type: 'mcq_single', choice: 'a' } }, otherCookie);
    expect(r.statusCode).toBe(403);
  });

  it('réponses : correction immédiate, puis échéance recalculée (juste : boîte 1, 1 jour ; faux : boîte 1 aussi, lapsus compté)', async () => {
    const keys = await db.select({ id: questions.id, key: questions.answerKey }).from(questions).where(inArray(questions.id, cards.map((c) => c.questionId)));
    const keyOf = new Map(keys.map((k) => [k.id, k.key]));
    const single = cards.find((c) => keyOf.get(c.questionId)?.type === 'mcq_single')!;
    const other = cards.find((c) => c !== single)!;
    const right = await call('POST', `/revision/sessions/${sessionId}/answers`, {
      questionId: single.questionId,
      response: responseFor(keyOf.get(single.questionId)!, true),
      tzOffsetMinutes: -60,
    });
    expect(right.statusCode).toBe(200);
    const r = right.json() as { correct: boolean; box: number; intervalDays: number; dueAt: string; feedback: { explanation: string; key: unknown } };
    expect(r).toMatchObject({ correct: true, box: 1, intervalDays: 1 });
    expect(r.feedback.explanation.length).toBeGreaterThan(10);
    expect(r.feedback.key).toEqual(keyOf.get(single.questionId));
    // Échéance : minuit (heure de Paris en hiver, UTC+1) du lendemain.
    const due = new Date(r.dueAt);
    expect(due.getTime()).toBeGreaterThan(Date.now());
    expect(due.getTime() - Date.now()).toBeLessThanOrEqual(2 * 86_400_000);
    expect((due.getUTCHours() + 1) % 24).toBe(0);

    const wrong = (await call('POST', `/revision/sessions/${sessionId}/answers`, {
      questionId: other.questionId,
      response: responseFor(keyOf.get(other.questionId)!, false),
    })).json() as { correct: boolean; box: number };
    expect(wrong).toMatchObject({ correct: false, box: 1 });
    const [card] = await db.select().from(reviewCards).where(and(eq(reviewCards.userId, userId), eq(reviewCards.questionId, other.questionId)));
    expect(card).toMatchObject({ box: 1, lapses: 1, reviews: 1 });

    // Une carte ne se répond qu'une fois par session ; le type de réponse doit être celui de la question.
    const twice = await call('POST', `/revision/sessions/${sessionId}/answers`, { questionId: single.questionId, response: responseFor(keyOf.get(single.questionId)!, true) });
    expect(twice.statusCode).toBe(409);
    const third = cards.find((c) => c !== single && c !== other && keyOf.get(c.questionId)?.type !== 'cli')!;
    const mismatch = await call('POST', `/revision/sessions/${sessionId}/answers`, { questionId: third.questionId, response: { type: 'cli', lines: [] } });
    expect(mismatch.statusCode).toBe(409);

    // La session rechargée montre la correction des cartes répondues, et seulement d'elles.
    const reloaded = (await call('GET', `/revision/sessions/${sessionId}`)).json() as { answeredCount: number; correctCount: number; cards: { questionId: string; answer: { feedback: unknown } | null }[] };
    expect(reloaded).toMatchObject({ answeredCount: 2, correctCount: 1 });
    expect(reloaded.cards.filter((c) => c.answer !== null).map((c) => c.questionId).sort()).toEqual([single.questionId, other.questionId].sort());
  });

  it('les cartes répondues ne sont plus dues aujourd’hui ; une échéance passée les rend dues', async () => {
    const o = (await call('GET', '/revision?certification=ccna')).json() as Overview;
    expect(o.dueToday).toBe(cards.length - 2);
    await db.update(reviewCards).set({ dueAt: new Date(Date.now() - 1000) }).where(and(eq(reviewCards.userId, userId), eq(reviewCards.questionId, cards[0]!.questionId)));
    const after = (await call('GET', '/revision?certification=ccna')).json() as Overview;
    expect(after.dueToday).toBe(cards.length - 1);
  });

  it('« Flashcards » depuis « À revoir » : session limitée au sous-thème, paquet ajouté au besoin', async () => {
    const o = (await call('GET', '/revision?certification=ccna', undefined, otherCookie)).json() as Overview;
    const target = o.decks.find((d) => d.available >= 3)!;
    const res = await call('POST', '/revision/sessions', { certification: 'ccna', subtopic: target.subtopic }, otherCookie);
    expect(res.statusCode).toBe(201);
    const s = res.json() as { cards: { subtopic: string }[] };
    expect(s.cards.length).toBe(target.available);
    expect(s.cards.every((c) => c.subtopic === target.subtopic)).toBe(true);
    // L'autre utilisateur, lui, n'a toujours que son paquet.
    const mine = (await call('GET', '/revision?certification=ccna')).json() as Overview;
    expect(mine.decks.filter((d) => d.enrolled).map((d) => d.subtopic)).toEqual([deck]);
  });

  it('historique des sessions', async () => {
    const res = await call('GET', '/revision/sessions?certification=ccna');
    const body = res.json() as { sessions: { id: string; answeredCount: number; correctCount: number; total: number }[] };
    expect(body.sessions[0]).toMatchObject({ id: sessionId, answeredCount: 2, correctCount: 1 });
  });
});
