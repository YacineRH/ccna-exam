import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseLab, type Lab } from '@examforge/core';
import { loadLabs } from '@examforge/content';
import { buildApp } from '../src/app.js';
import { createDb, type Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { certifications, labAttempts, users } from '../src/db/schema.js';
import { seedContent } from '../src/db/seed.js';
import { upsertLab } from '../src/services/content-sync.js';
import { loadEnv } from '../src/env.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;

/*
 * Challenges chronométrés : un lab avec `kind: challenge`, sans indice, fini à la réussite ou à
 * l'échéance (contrôlée côté serveur). Le challenge de test est tiré d'un lab du contenu, pour ne pas
 * dépendre des challenges publiés.
 */
describe.skipIf(!DATABASE_URL)('API v1 : challenges (PostgreSQL)', () => {
  let app: FastifyInstance;
  let db: Db;
  let pool: pg.Pool;
  let cookie = '';
  let otherCookie = '';
  const base = loadLabs('ccna').labs.find((l) => l.slug === 'ccna-lab-1.3-interfaces') as Lab;
  const challenge = parseLab({
    ...base,
    slug: 'ccna-challenge-test-interfaces',
    title: 'Challenge de test : remettre les interfaces en service',
    kind: 'challenge',
    hints: [],
    challenge: { targetMinutes: 4, timeLimitMinutes: 8, mode: 'troubleshoot', faults: ['Interface laissée en shutdown sur le LAN.'] },
    devices: base.devices.map((d) => ({ ...d, startupConfig: `${d.startupConfig}\nip domain-name test.lan` })),
  });
  const seen: string[] = [];
  const solutionText = challenge.solution.flatMap((s) => s.commands).filter((c) => c.length > 12);

  const call = async (method: 'GET' | 'POST', url: string, body?: unknown, as = cookie) =>
    app.inject({ method, url: `/api/v1${url}`, payload: body as object, headers: as ? { cookie: as } : {} });
  const track = async (method: 'GET' | 'POST', url: string, body?: unknown) => {
    const res = await call(method, url, body);
    seen.push(res.body);
    return res;
  };
  const send = (id: string, input: string) => track('POST', `/lab-attempts/${id}/commands`, { input });

  beforeAll(async () => {
    ({ db, pool } = createDb(DATABASE_URL!));
    await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
    await runMigrations(db);
    await seedContent(db);
    const [cert] = await db.select().from(certifications).where(eq(certifications.code, 'ccna'));
    await upsertLab(db, cert!.id, challenge);
    const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: DATABASE_URL!, JWT_SECRET: 'x'.repeat(40), SERVICE_TOKEN: 's'.repeat(40) });
    app = await buildApp(env, db);
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'chrono@example.com', password: 'correct-horse-battery', displayName: 'Chrono' },
    });
    cookie = `ef_session=${reg.cookies.find((x) => x.name === 'ef_session')?.value}`;
    const [other] = await db.insert(users).values({ email: 'autre-chrono@example.com', passwordHash: 'x', displayName: 'Autre' }).returning();
    otherCookie = `ef_session=${await app.jwt.sign({ sub: other!.id, role: 'user' })}`;
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it('les challenges ont leur liste ; ils n’apparaissent pas parmi les labs', async () => {
    const res = await track('GET', '/labs?certification=ccna&kind=challenge');
    expect(res.statusCode).toBe(200);
    const list = (res.json() as { labs: { slug: string; kind: string; challenge: { targetMinutes: number; timeLimitMinutes: number; mode: string } }[] }).labs;
    const mine = list.find((l) => l.slug === challenge.slug);
    expect(mine).toMatchObject({ kind: 'challenge', challenge: { targetMinutes: 4, timeLimitMinutes: 8, mode: 'troubleshoot' } });
    expect(list.every((l) => l.kind === 'challenge')).toBe(true);
    const labsOnly = (await call('GET', '/labs?certification=ccna')).json() as { labs: { slug: string; kind: string }[] };
    expect(labsOnly.labs.some((l) => l.slug === challenge.slug)).toBe(false);
    expect(labsOnly.labs.every((l) => l.kind === 'lab')).toBe(true);
  });

  it('détail public : temps cible et échéance, ni pannes ni solution', async () => {
    const res = await track('GET', `/labs/${challenge.slug}`);
    const body = res.json() as { lab: { kind: string; hintCount: number; challenge: { mode: string } } };
    expect(body.lab).toMatchObject({ kind: 'challenge', hintCount: 0, challenge: { mode: 'troubleshoot' } });
    expect(res.body).not.toContain('shutdown sur le LAN');
  });

  let attemptId = '';
  it('démarre un essai : échéance fixée par le serveur', async () => {
    const res = await track('POST', `/labs/${challenge.slug}/attempts`);
    expect(res.statusCode).toBe(201);
    const s = res.json() as { id: string; kind: string; startedAt: string; deadlineAt: string; serverNow: string; result: null };
    attemptId = s.id;
    expect(s.kind).toBe('challenge');
    expect(new Date(s.deadlineAt).getTime() - new Date(s.startedAt).getTime()).toBe(8 * 60_000);
    expect(s.result).toBeNull();
  });

  it('aucun indice dans un challenge', async () => {
    const res = await call('POST', `/lab-attempts/${attemptId}/hint`);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('no_hints');
  });

  it('un autre utilisateur ne peut ni voir ni jouer l’essai', async () => {
    expect((await call('GET', `/lab-attempts/${attemptId}`, undefined, otherCookie)).statusCode).toBe(403);
    expect((await call('POST', `/lab-attempts/${attemptId}/commands`, { input: 'enable' }, otherCookie)).statusCode).toBe(403);
  });

  it('résolu avant l’échéance : fin automatique, chrono figé, écran de fin avec la solution et les pannes', async () => {
    // Rien de la solution n'est parti avant la première commande.
    for (const t of seen) for (const c of solutionText) expect(t).not.toContain(`"${c}"`);
    const steps = challenge.solution[0]!.commands;
    const head = steps.slice(0, -1).join('\n');
    const partial = await send(attemptId, head);
    expect(partial.statusCode).toBe(200);
    expect((partial.json() as { finished: boolean }).finished).toBe(false);
    expect(partial.body).not.toContain('"solution"');
    const last = await call('POST', `/lab-attempts/${attemptId}/commands`, { input: steps.at(-1) });
    const done = last.json() as { complete: boolean; finished: boolean };
    expect(done).toMatchObject({ complete: true, finished: true });
    const state = (await call('GET', `/lab-attempts/${attemptId}`)).json() as {
      status: string;
      expired: boolean;
      result: { success: boolean; durationSeconds: number; faults: string[]; solution: unknown; targetMinutes: number };
    };
    expect(state.status).toBe('finished');
    expect(state.expired).toBe(false);
    expect(state.result).toMatchObject({ success: true, faults: challenge.challenge!.faults, targetMinutes: 4 });
    expect(state.result.durationSeconds).toBeGreaterThanOrEqual(0);
    // Une commande de plus est refusée : l'essai est clos.
    expect((await call('POST', `/lab-attempts/${attemptId}/commands`, { input: 'show run' })).statusCode).toBe(409);
  });

  it('classement personnel : meilleur temps et temps de chaque essai', async () => {
    const res = await call('GET', `/labs/${challenge.slug}/times`);
    const body = res.json() as { bestSeconds: number | null; targetMinutes: number; times: { success: boolean; durationSeconds: number }[] };
    expect(body.targetMinutes).toBe(4);
    expect(body.times).toHaveLength(1);
    expect(body.bestSeconds).toBe(body.times[0]!.durationSeconds);
    const list = (await call('GET', '/labs?certification=ccna&kind=challenge')).json() as { labs: { slug: string; done: boolean; bestSeconds: number | null }[] };
    expect(list.labs.find((l) => l.slug === challenge.slug)).toMatchObject({ done: true, bestSeconds: body.bestSeconds });
  });

  it('échéance dépassée : commandes refusées, fin automatique côté serveur, solution révélée', async () => {
    const start = (await call('POST', `/labs/${challenge.slug}/attempts`)).json() as { id: string };
    await send(start.id, 'enable\nconfigure terminal');
    // L'échéance passe (plus la tolérance) : on recule l'horloge de l'essai plutôt que d'attendre.
    await db
      .update(labAttempts)
      .set({ startedAt: new Date(Date.now() - 9 * 60_000), deadlineAt: new Date(Date.now() - 60_000) })
      .where(eq(labAttempts.id, start.id));
    const late = await call('POST', `/lab-attempts/${start.id}/commands`, { input: 'interface g0/0/0' });
    expect(late.statusCode).toBe(409);
    expect((late.json() as { error: { code: string } }).error.code).toBe('challenge_expired');
    const state = (await call('GET', `/lab-attempts/${start.id}`)).json() as {
      status: string;
      expired: boolean;
      transcript: unknown[];
      result: { success: boolean; expired: boolean; solution: unknown[] };
    };
    expect(state).toMatchObject({ status: 'finished', expired: true });
    expect(state.transcript).toHaveLength(2);
    expect(state.result.success).toBe(false);
    expect(state.result.solution.length).toBeGreaterThan(0);
    const times = (await call('GET', `/labs/${challenge.slug}/times`)).json() as { times: { expired: boolean; success: boolean }[] };
    expect(times.times.filter((t) => t.expired)).toHaveLength(1);
    expect(times.times.filter((t) => t.success)).toHaveLength(1);
  });

  it('un nouveau départ abandonne l’essai en cours', async () => {
    const a = (await call('POST', `/labs/${challenge.slug}/attempts`)).json() as { id: string };
    const b = (await call('POST', `/labs/${challenge.slug}/attempts`)).json() as { id: string };
    expect(a.id).not.toBe(b.id);
    const old = (await call('GET', `/lab-attempts/${a.id}`)).json() as { status: string; result: { success: boolean } };
    expect(old.status).toBe('finished');
    expect(old.result.success).toBe(false);
    await call('POST', `/lab-attempts/${b.id}/finish`);
  });

  it('historique filtré : challenges seulement', async () => {
    const res = await call('GET', '/lab-attempts?certification=ccna&kind=challenge');
    const body = res.json() as { attempts: { kind: string; slug: string; expired: boolean }[] };
    expect(body.attempts.length).toBe(4);
    expect(body.attempts.every((a) => a.kind === 'challenge')).toBe(true);
    const labsOnly = (await call('GET', '/lab-attempts?certification=ccna&kind=lab')).json() as { attempts: unknown[] };
    expect(labsOnly.attempts).toHaveLength(0);
  });
});
