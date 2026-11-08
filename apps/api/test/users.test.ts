import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCertification } from '@examforge/core';
import { buildApp } from '../src/app.js';
import { createDb, type Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { attempts, users } from '../src/db/schema.js';
import { loadEnv } from '../src/env.js';
import { upsertCertification } from '../src/services/content-sync.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SERVICE_TOKEN = 's'.repeat(40);

/*
 * Comptes invités : l'administrateur en crée depuis une session (jamais avec le jeton de service du MCP),
 * les inscriptions restent fermées, et un invité n'a aucun accès aux routes d'administration.
 */
describe.skipIf(!DATABASE_URL)('API v1 : comptes invités (PostgreSQL)', () => {
  let app: FastifyInstance;
  let db: Db;
  let pool: pg.Pool;
  let adminCookie = '';

  const cookieOf = (res: { cookies: { name: string; value: string }[] }) => {
    const c = res.cookies.find((x) => x.name === 'ef_session');
    return c ? `ef_session=${c.value}` : '';
  };
  const call = (method: 'GET' | 'POST', url: string, body?: unknown, headers: Record<string, string> = adminCookie ? { cookie: adminCookie } : {}) =>
    app.inject({ method, url: `/api/v1${url}`, payload: body as object, headers });
  const login = async (email: string, password: string) => call('POST', '/auth/login', { email, password }, {});

  beforeAll(async () => {
    ({ db, pool } = createDb(DATABASE_URL!));
    await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
    await runMigrations(db);
    const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: DATABASE_URL!, JWT_SECRET: 'x'.repeat(40), SERVICE_TOKEN, RATE_LIMIT_MAX: '100000' });
    app = await buildApp(env, db);
    const reg = await call('POST', '/auth/register', { email: 'admin@example.com', password: 'correct-horse-battery', displayName: 'Admin' }, {});
    expect(reg.json().user.role).toBe('admin');
    adminCookie = cookieOf(reg);
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it('crée un invité avec un mot de passe généré, renvoyé une seule fois, et il peut se connecter', async () => {
    const res = await call('POST', '/admin/users', { email: 'Ami@Example.com', displayName: ' Ami ' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.generated).toBe(true);
    expect(body.user).toMatchObject({ email: 'ami@example.com', displayName: 'Ami', role: 'user' });
    expect(body.password).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|argon2/i);

    const ok = await login('ami@example.com', body.password);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.role).toBe('user');
    expect((await login('ami@example.com', `${body.password}x`)).statusCode).toBe(401);
    // Le mot de passe n'est stocké que haché.
    const [row] = await db.select({ hash: users.passwordHash }).from(users).where(sql`lower(${users.email}) = 'ami@example.com'`);
    expect(row!.hash).toMatch(/^\$argon2id\$/);
    expect(row!.hash).not.toContain(body.password);
  });

  it('accepte un mot de passe choisi, sans le renvoyer', async () => {
    const res = await call('POST', '/admin/users', { email: 'choisi@example.com', displayName: 'Choisi', password: 'un-mot-de-passe-choisi' });
    expect(res.statusCode).toBe(201);
    expect(res.json().generated).toBe(false);
    expect(res.json()).not.toHaveProperty('password');
    expect((await login('choisi@example.com', 'un-mot-de-passe-choisi')).statusCode).toBe(200);
  });

  it('refuse un e-mail déjà pris (sans tenir compte de la casse) et les saisies invalides', async () => {
    const dup = await call('POST', '/admin/users', { email: 'AMI@example.com', displayName: 'Doublon' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('email_taken');
    const adminDup = await call('POST', '/admin/users', { email: 'admin@example.com', displayName: 'Autre' });
    expect(adminDup.statusCode).toBe(409);

    for (const body of [
      { email: 'pas-un-email', displayName: 'X' },
      { email: 'x@example.com', displayName: '   ' },
      { email: 'x@example.com', displayName: 'X', password: 'trop-court' },
      { displayName: 'X' },
    ]) {
      expect((await call('POST', '/admin/users', body)).statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it('ne crée jamais d’administrateur, même si on le demande', async () => {
    const res = await call('POST', '/admin/users', { email: 'pirate@example.com', displayName: 'Pirate', role: 'admin' });
    expect(res.statusCode).toBe(201);
    expect(res.json().user.role).toBe('user');
  });

  it('liste les comptes avec leur activité, sans aucun secret', async () => {
    // Une petite certification et deux séances de l'invité « choisi » : elles comptent pour lui, pour personne d'autre.
    const certId = await upsertCertification(
      db,
      parseCertification({
        code: 'users-test',
        name: 'Test des comptes',
        vendor: 'Test',
        examCode: 'U-1',
        domains: [{ code: 'A', name: 'Alpha', weight: 1 }],
        scoring: { min: 0, max: 100, passing: 50 },
        examFormat: { questionCount: 3, durationMinutes: 5, allowBackNavigation: true },
        allowedQuestionTypes: ['mcq_single'],
      }),
    );
    const [choisi] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = 'choisi@example.com'`);
    const t1 = new Date('2026-11-01T10:00:00Z');
    const t2 = new Date('2026-11-03T15:30:00Z');
    for (const startedAt of [t1, t2]) {
      await db.insert(attempts).values({ userId: choisi!.id, certificationId: certId, mode: 'practice', seed: 1, allowBackNavigation: true, totalCount: 3, startedAt });
    }

    const list = (await call('GET', '/admin/users')).json().users as { email: string; role: string; attempts: number; lastActiveAt: string | null; createdAt: string }[];
    expect(list.map((u) => u.email).sort()).toEqual(['admin@example.com', 'ami@example.com', 'choisi@example.com', 'pirate@example.com']);
    expect(list.find((u) => u.email === 'admin@example.com')?.role).toBe('admin');
    expect(list.find((u) => u.email === 'choisi@example.com')).toMatchObject({ attempts: 2, lastActiveAt: t2.toISOString() });
    expect(list.filter((u) => u.email !== 'choisi@example.com').every((u) => u.attempts === 0 && u.lastActiveAt === null)).toBe(true);
    expect(list.every((u) => !Number.isNaN(Date.parse(u.createdAt)))).toBe(true);
    expect(JSON.stringify(list)).not.toMatch(/passwordHash|argon2|password/i);
    // Les plus récents d'abord.
    expect(list[0]!.createdAt >= list.at(-1)!.createdAt).toBe(true);
  });

  it('refuse un visiteur anonyme et le jeton de service', async () => {
    // Visiteur anonyme : 401.
    expect((await call('GET', '/admin/users', undefined, {})).statusCode).toBe(401);
    expect((await call('POST', '/admin/users', { email: 'a@example.com', displayName: 'A' }, {})).statusCode).toBe(401);
    // Jeton de service (MCP) : 403, même s'il agit au nom de l'administrateur.
    const bearer = { authorization: `Bearer ${SERVICE_TOKEN}` };
    const svcList = await call('GET', '/admin/users', undefined, bearer);
    expect(svcList.statusCode).toBe(403);
    expect(svcList.json().error.message).toMatch(/jeton de service/);
    expect((await call('POST', '/admin/users', { email: 'svc@example.com', displayName: 'Svc' }, bearer)).statusCode).toBe(403);
    // Il garde ses droits habituels (génération de contenu) : les autres routes d'administration lui répondent.
    expect((await call('GET', '/admin/exams?certification=users-test', undefined, bearer)).statusCode).toBe(200);
  });

  it('un invité connecté ne peut ni lister ni créer de comptes', async () => {
    const guestLogin = await login('choisi@example.com', 'un-mot-de-passe-choisi');
    const headers = { cookie: cookieOf(guestLogin) };
    const list = await call('GET', '/admin/users', undefined, headers);
    expect(list.statusCode).toBe(403);
    expect(list.json().error.message).toMatch(/administrateurs/);
    expect((await call('POST', '/admin/users', { email: 'z@example.com', displayName: 'Z' }, headers)).statusCode).toBe(403);
    expect((await call('GET', '/admin/certifications', undefined, headers)).statusCode).toBe(403);
  });

  it('les inscriptions restent fermées pour tout le monde', async () => {
    const res = await call('POST', '/auth/register', { email: 'intrus@example.com', password: 'correct-horse-battery', displayName: 'Intrus' }, {});
    expect(res.statusCode).toBe(403);
  });
});
