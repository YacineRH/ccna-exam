import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Lab } from '@examforge/core';
import { loadLabs } from '@examforge/content';
import { buildApp } from '../src/app.js';
import { createDb, type Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { users } from '../src/db/schema.js';
import { seedContent } from '../src/db/seed.js';
import { loadEnv } from '../src/env.js';
import { splitInput } from '../src/services/labs.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe('découpage des saisies', () => {
  it('collage multi-ligne, retours chariot, Ctrl+Z', () => {
    expect(splitInput('enable\r\nconf t\n\nint g0/0\x1a')).toEqual(['enable', 'conf t', 'int g0/0', '\x1a']);
    expect(splitInput('')).toEqual(['']);
  });
});

describe.skipIf(!DATABASE_URL)('API v1 : labs CLI (PostgreSQL)', () => {
  let app: FastifyInstance;
  let db: Db;
  let pool: pg.Pool;
  let cookie = '';
  let otherCookie = '';
  const { labs } = loadLabs('ccna');
  const lab = labs.find((l) => l.slug === 'ccna-lab-1.3-interfaces') as Lab;
  /** Toutes les réponses reçues avant `finish` : la solution ne doit apparaître dans aucune. */
  const seen: string[] = [];

  const call = async (method: 'GET' | 'POST', url: string, body?: unknown, as = cookie) => {
    const res = await app.inject({ method, url: `/api/v1${url}`, payload: body as object, headers: as ? { cookie: as } : {} });
    return res;
  };
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
    const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: DATABASE_URL!, JWT_SECRET: 'x'.repeat(40), SERVICE_TOKEN: 's'.repeat(40) });
    app = await buildApp(env, db);
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'labs@example.com', password: 'correct-horse-battery', displayName: 'Labs' },
    });
    const c = reg.cookies.find((x) => x.name === 'ef_session');
    cookie = `ef_session=${c?.value}`;
    // Un second utilisateur (les inscriptions sont fermées après le premier compte).
    const [other] = await db.insert(users).values({ email: 'autre@example.com', passwordHash: 'x', displayName: 'Autre' }).returning();
    otherCookie = `ef_session=${await app.jwt.sign({ sub: other!.id, role: 'user' })}`;
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it('liste les labs de la certification, sans solution', async () => {
    const res = await track('GET', '/labs?certification=ccna');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { labs: { slug: string; title: string; difficulty: string; subtopic: string; subtopicName: string; bestSeconds: number | null; done: boolean }[] };
    expect(body.labs.map((l) => l.slug).sort()).toEqual(labs.filter((l) => l.kind === 'lab').map((l) => l.slug).sort());
    const first = body.labs.find((l) => l.slug === lab.slug)!;
    expect(first).toMatchObject({ title: lab.title, difficulty: lab.difficulty, subtopic: lab.subtopic, bestSeconds: null, done: false });
    expect(first.subtopicName.length).toBeGreaterThan(0);
    expect((await call('GET', '/labs?certification=ccna', undefined, '')).statusCode).toBe(401);
    expect((await call('GET', '/labs?certification=inconnue')).statusCode).toBe(404);
  });

  it('détail d’un lab : énoncé, topologie, objectifs, sans la solution', async () => {
    const res = await track('GET', `/labs/${lab.slug}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.lab.statement).toBe(lab.statement);
    expect(body.lab.topology).toBe(lab.topology);
    expect(body.lab.objectives).toEqual(lab.objectives.map((o) => ({ id: o.id, description: o.description })));
    expect(body.lab.hintCount).toBe(3);
    expect((await call('GET', '/labs/inconnu')).statusCode).toBe(404);
  });

  let attemptId = '';

  it('démarre une session : prompt de départ, aucun objectif atteint', async () => {
    const res = await track('POST', `/labs/${lab.slug}/attempts`);
    expect(res.statusCode).toBe(201);
    const state = res.json();
    attemptId = state.id;
    expect(state.status).toBe('in_progress');
    expect(state.devices).toEqual([{ id: 'R1', type: 'router', prompt: 'R1>' }]);
    expect(state.achieved).toEqual([]);
    expect(state.result).toBeNull();
    expect(Date.parse(state.serverNow)).not.toBeNaN();
  });

  it('exécute les commandes côté serveur : sortie, prompt, erreurs IOS, objectifs, serverNow', async () => {
    let r = (await send(attemptId, 'enable')).json();
    expect(r.prompt).toBe('R1#');
    expect(Date.parse(r.serverNow)).not.toBeNaN();
    r = (await send(attemptId, 'conf t')).json();
    expect(r.prompt).toBe('R1(config)#');
    r = (await send(attemptId, 'interfce g0/0/0')).json();
    expect(r.results[0].status).toBe('error');
    expect(r.results[0].output).toContain("% Invalid input detected at '^' marker.");
    r = (await send(attemptId, 'int g0/0/0')).json();
    expect(r.prompt).toBe('R1(config-if)#');
    // Commandes envoyées une à une : l'état reconstitué suit l'ordre de saisie.
    r = (await send(attemptId, 'description brouillon')).json();
    r = (await send(attemptId, 'description LAN utilisateurs')).json();
    expect(r.achieved).toEqual(['g000-description']);
    r = (await send(attemptId, 'ip address 192.168.10.1 255.255.255.192\nno shutdown')).json();
    expect(r.results).toHaveLength(2);
    expect(r.achieved).toEqual(['g000-description', 'g000-address', 'g000-up']);
    expect(r.complete).toBe(false);
    r = (await send(attemptId, '?')).json();
    expect(r.results[0].status).toBe('help');
    expect(r.results[0].output).toContain('Interface configuration commands:');
  });

  it('rejoue les commandes dans l’ordre pour reconstituer la session', async () => {
    const state = (await track('GET', `/lab-attempts/${attemptId}`)).json();
    expect(state.devices[0].prompt).toBe('R1(config-if)#');
    expect(state.transcript.map((t: { echo: string }) => t.echo)).toEqual([
      'R1>enable',
      'R1#conf t',
      'R1(config)#interfce g0/0/0',
      'R1(config)#int g0/0/0',
      'R1(config-if)#description brouillon',
      'R1(config-if)#description LAN utilisateurs',
      'R1(config-if)#ip address 192.168.10.1 255.255.255.192',
      'R1(config-if)#no shutdown',
      'R1(config-if)#?',
    ]);
    expect(state.achieved).toEqual(['g000-description', 'g000-address', 'g000-up']);
    expect(state.commandCount).toBe(9);
  });

  it('commandes simultanées : jouées l’une après l’autre, sans trou ni doublon', async () => {
    const before = (await call('GET', `/lab-attempts/${attemptId}`)).json().commandCount as number;
    const all = await Promise.all(['exit', 'exit', 'exit'].map(() => send(attemptId, 'do show running-config | include hostname')));
    expect(all.every((r) => r.statusCode === 200)).toBe(true);
    const state = (await call('GET', `/lab-attempts/${attemptId}`)).json();
    expect(state.commandCount).toBe(before + 3);
    expect(state.transcript.slice(-3).every((t: { output: string }) => t.output === 'hostname R1')).toBe(true);
  });

  it('indices progressifs, comptés, au plus trois', async () => {
    for (let level = 1; level <= 3; level++) {
      const res = await track('POST', `/lab-attempts/${attemptId}/hint`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ level, hint: lab.hints[level - 1], hintsUsed: level });
    }
    expect((await call('POST', `/lab-attempts/${attemptId}/hint`)).statusCode).toBe(409);
    expect((await track('GET', `/lab-attempts/${attemptId}`)).json().hints).toEqual(lab.hints);
  });

  it('on ne peut pas jouer la session d’un autre utilisateur', async () => {
    expect((await call('GET', `/lab-attempts/${attemptId}`, undefined, otherCookie)).statusCode).toBe(403);
    expect((await call('POST', `/lab-attempts/${attemptId}/commands`, { input: 'show running-config' }, otherCookie)).statusCode).toBe(403);
    expect((await call('POST', `/lab-attempts/${attemptId}/hint`, undefined, otherCookie)).statusCode).toBe(403);
    expect((await call('POST', `/lab-attempts/${attemptId}/finish`, undefined, otherCookie)).statusCode).toBe(403);
    expect((await call('GET', '/lab-attempts', undefined, otherCookie)).json().attempts).toEqual([]);
    // Rien n'a été ajouté à la session par l'autre utilisateur.
    expect((await call('GET', `/lab-attempts/${attemptId}`)).json().commandCount).toBe(12);
  });

  it('valide les entrées : équipement inconnu, trop de lignes, ligne trop longue', async () => {
    expect((await call('POST', `/lab-attempts/${attemptId}/commands`, { device: 'R9', input: 'enable' })).statusCode).toBe(400);
    expect((await call('POST', `/lab-attempts/${attemptId}/commands`, { input: Array(61).fill('!').join('\n') })).statusCode).toBe(400);
    expect((await call('POST', `/lab-attempts/${attemptId}/commands`, { input: 'description ' + 'x'.repeat(400) })).statusCode).toBe(400);
    expect((await call('POST', `/lab-attempts/00000000-0000-0000-0000-000000000000/commands`, { input: 'enable' })).statusCode).toBe(404);
  });

  it('la solution n’apparaît dans aucune réponse avant finish', () => {
    const solution = lab.solution.flatMap((s) => s.commands);
    for (const body of seen) {
      expect(body).not.toContain(lab.explanation);
      expect(body).not.toContain(lab.reference);
      expect(body).not.toContain('"solution"');
      expect(body).not.toContain('"variants"');
      expect(body).not.toContain('"check"');
      expect(body.includes(JSON.stringify(solution))).toBe(false);
      expect(body.includes(JSON.stringify(lab.solution))).toBe(false);
    }
  });

  it('collage multi-ligne de la fin de la solution, puis finish : solution, explication et configuration saisie', async () => {
    const rest = ['interface GigabitEthernet0/0/1', 'description Lien vers FAI', 'ip address 203.0.113.2 255.255.255.252', 'no shutdown', '\x1a', 'copy running-config startup-config'];
    const r = (await send(attemptId, rest.join('\n'))).json();
    expect(r.complete).toBe(true);
    expect(r.achieved).toEqual(lab.objectives.map((o) => o.id));

    const fin = await call('POST', `/lab-attempts/${attemptId}/finish`);
    expect(fin.statusCode).toBe(200);
    const state = fin.json();
    expect(state.status).toBe('finished');
    expect(state.result.success).toBe(true);
    expect(state.result.solution).toEqual(lab.solution);
    expect(state.result.explanation).toBe(lab.explanation);
    expect(state.result.reference).toBe(lab.reference);
    expect(state.result.durationSeconds).toBeGreaterThanOrEqual(0);
    expect(state.result.typed[0].device).toBe('R1');
    expect(state.result.typed[0].commands).toContain('description LAN utilisateurs');
    expect(state.result.typed[0].commands).not.toContain('interfce g0/0/0');
    expect(state.result.runningConfig.R1).toContain('interface GigabitEthernet0/0/1\n description Lien vers FAI');

    // Terminée : plus de commandes ni d'indices ; finish est idempotent.
    expect((await call('POST', `/lab-attempts/${attemptId}/commands`, { input: 'enable' })).statusCode).toBe(409);
    expect((await call('POST', `/lab-attempts/${attemptId}/hint`)).statusCode).toBe(409);
    expect((await call('POST', `/lab-attempts/${attemptId}/finish`)).json().result.success).toBe(true);
  });

  it('historique : temps, indices, réussite ; le lab est marqué fait avec son meilleur temps', async () => {
    const history = (await call('GET', '/lab-attempts?certification=ccna')).json().attempts;
    expect(history[0]).toMatchObject({ id: attemptId, slug: lab.slug, status: 'finished', success: true, hintsUsed: 3, commandCount: 18 });
    expect(history[0].durationSeconds).toBeGreaterThanOrEqual(0);
    const listed = (await call('GET', '/labs?certification=ccna')).json().labs.find((l: { slug: string }) => l.slug === lab.slug);
    expect(listed.done).toBe(true);
    expect(listed.bestSeconds).toBe(history[0].durationSeconds);
    expect(listed.attempts).toBe(1);
  });

  it('les labs alimentent le tableau de bord : maîtrise du domaine et sous-thème à revoir', async () => {
    const failed = labs.find((l) => l.slug !== lab.slug && l.domain !== lab.domain) ?? labs.find((l) => l.slug !== lab.slug);
    let stats = (await call('GET', '/stats?certification=ccna')).json();
    expect(stats.labs).toMatchObject({ total: labs.length, attempted: 1, solved: 1 });
    const domain = stats.domains.find((d: { code: string }) => d.code === lab.domain);
    expect(domain).toMatchObject({ answered: 1, correct: 1 });
    if (!failed) return;
    const started = (await call('POST', `/labs/${failed.slug}/attempts`)).json();
    await call('POST', `/lab-attempts/${started.id}/commands`, { device: failed.devices[0]!.id, input: 'enable' });
    const end = (await call('POST', `/lab-attempts/${started.id}/finish`)).json();
    expect(end.result.success).toBe(false);
    expect(end.result.durationSeconds).toBeGreaterThanOrEqual(0);
    stats = (await call('GET', '/stats?certification=ccna')).json();
    expect(stats.toReview.map((t: { subtopic: string }) => t.subtopic)).toContain(failed.subtopic);
    expect(stats.labs).toMatchObject({ attempted: 2, solved: 1 });
  });

  describe('administration (MCP) : génération et double validation', () => {
    const admin = (method: 'GET' | 'POST', url: string, body?: unknown) =>
      app.inject({ method, url: `/api/v1/admin${url}`, payload: body as object, headers: { authorization: `Bearer ${'s'.repeat(40)}` } });
    const fresh = (): Lab => ({ ...structuredClone(lab), slug: 'ccna-lab-1.3-interfaces-ia-001', title: 'Mettre en service les interfaces (variante générée)' });

    it('expose le profil de terminal (commandes disponibles par mode)', async () => {
      const res = await admin('GET', '/lab-profile?certification=ccna');
      expect(res.statusCode).toBe(200);
      expect(res.json().commands.some((c: { syntax: string }) => c.syntax === 'hostname <word>')).toBe(true);
    });

    it('refuse un lab dont la solution ne passe pas le simulateur', async () => {
      const broken = fresh();
      broken.solution = [{ device: 'R1', commands: ['enable', 'configure terminal', 'interface g0/0/0', 'ip adress 192.168.10.1 255.255.255.192'] }];
      const res = await admin('POST', '/labs', { lab: broken });
      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(res.json().error.details)).toContain('ip adress');
    });

    it('soumis, validé, puis publié après relecture', async () => {
      const res = await admin('POST', '/labs', { lab: fresh() });
      expect(res.statusCode).toBe(201);
      expect(res.json().status).toBe('validated');
      const listed = () => call('GET', '/labs?certification=ccna').then((r) => r.json().labs.map((l: { slug: string }) => l.slug));
      expect(await listed()).not.toContain('ccna-lab-1.3-interfaces-ia-001');
      const full = (await admin('GET', '/labs/ccna-lab-1.3-interfaces-ia-001')).json();
      expect(full.lab.solution).toEqual(lab.solution);
      const review = await admin('POST', '/labs/ccna-lab-1.3-interfaces-ia-001/review', { approved: true });
      expect(review.json().status).toBe('published');
      expect(await listed()).toContain('ccna-lab-1.3-interfaces-ia-001');
      expect((await admin('POST', '/labs', { lab: fresh() })).statusCode).toBe(409);
    });

    it('refuse un titre déjà pris par un autre lab', async () => {
      const twin = { ...fresh(), slug: 'ccna-lab-1.3-interfaces-ia-002' };
      const res = await admin('POST', '/labs', { lab: twin });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('duplicate_lab');
    });
  });
});
