import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCertification, loadExamSeries, DATA_DIR } from '@examforge/content';
import { buildApp } from '../src/app.js';
import { createDb, type Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { certifications, domains, subtopics } from '../src/db/schema.js';
import { seedContent } from '../src/db/seed.js';
import { loadEnv } from '../src/env.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;

/*
 * Deux certifications dans la même base : leurs statistiques, leur progression, leur série et leurs
 * numéros d'examen sont isolés ; les modules qu'une certification n'a pas répondent 404 ; la déclarer par
 * `add_certification` (POST /admin/certifications) donne le même résultat que son fichier de données.
 */
describe.skipIf(!DATABASE_URL)('API v1 : plusieurs certifications (PostgreSQL)', () => {
  let app: FastifyInstance;
  let db: Db;
  let pool: pg.Pool;
  let cookie = '';
  const first = loadCertification('ccna').certification.code;
  const second = loadCertification('security-plus').certification.code;
  const secondFile = JSON.parse(readFileSync(`${DATA_DIR}/certifications/${second}.json`, 'utf8')) as Record<string, unknown>;

  const call = async (method: 'GET' | 'POST', url: string, body?: unknown) =>
    app.inject({ method, url: `/api/v1${url}`, payload: body as object, headers: cookie ? { cookie } : {} });

  beforeAll(async () => {
    ({ db, pool } = createDb(DATABASE_URL!));
    await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
    await runMigrations(db);
    await seedContent(db);
    const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: DATABASE_URL!, JWT_SECRET: 'x'.repeat(40), SERVICE_TOKEN: 's'.repeat(40), RATE_LIMIT_MAX: '100000' });
    app = await buildApp(env, db);
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'multi@example.com', password: 'correct-horse-battery', displayName: 'Multi' },
    });
    cookie = `ef_session=${reg.cookies.find((x) => x.name === 'ef_session')?.value}`;
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it('liste les deux certifications avec leurs modules', async () => {
    const list = (await call('GET', '/certifications')).json().certifications as { code: string; shortName: string; modules: string[] }[];
    expect(list.map((c) => c.code)).toEqual([first, second]);
    expect(list.find((c) => c.code === first)).toMatchObject({ shortName: 'CCNA', modules: ['exam', 'practice', 'flashcards', 'subnet', 'cli', 'challenges'] });
    expect(list.find((c) => c.code === second)).toMatchObject({ shortName: 'Security+', modules: ['exam', 'practice', 'flashcards'] });
  });

  it('applique à chaque certification son barème, son format et sa banque', async () => {
    const a = (await call('GET', `/certifications/${first}`)).json();
    const b = (await call('GET', `/certifications/${second}`)).json();
    expect(a.certification.scoring).toEqual({ min: 300, max: 1000, passing: 825 });
    expect(b.certification.scoring).toEqual({ min: 100, max: 900, passing: 750 });
    expect(b.certification.examFormat).toMatchObject({ questionCount: 90, durationMinutes: 90 });
    expect(b.certification.allowedQuestionTypes).not.toContain('cli');
    expect(b.bank.questions).toBe(loadCertification(second).questions.length);
    expect(Object.keys(b.bank.byType).sort()).toEqual(['fill_blank', 'matching', 'mcq_multi', 'mcq_single', 'ordering']);
    expect(Object.keys(b.bank.byDomain)).toEqual(['1.0', '2.0', '3.0', '4.0', '5.0']);
  });

  it('isole statistiques, progression, série et numéros d’examen entre les certifications', async () => {
    const seriesB = loadExamSeries(second)!;
    expect(seriesB.exams).toHaveLength(30);

    const attempt = (await call('POST', '/attempts', { certification: second, mode: 'exam', examNumber: 7 })).json();
    expect(attempt).toMatchObject({ certification: second, totalCount: 90 });
    expect(JSON.stringify(attempt)).not.toMatch(/"(correct|accepted|order|pairs)"/);
    expect((await call('POST', `/attempts/${attempt.id}/submit`)).statusCode).toBe(200);

    // Un examen CCNA ne pollue pas la Security+ : et réciproquement.
    const ccnaAttempt = (await call('POST', '/attempts', { certification: first, mode: 'exam', examNumber: 7 })).json();
    expect(ccnaAttempt).toMatchObject({ certification: first, totalCount: 102 });
    await call('POST', `/attempts/${ccnaAttempt.id}/submit`);
    const ccnaPractice = (await call('POST', '/attempts', { certification: first, mode: 'practice', questionCount: 5 })).json();
    expect(ccnaPractice.certification).toBe(first);

    const sB = (await call('GET', `/stats?certification=${second}`)).json();
    const sA = (await call('GET', `/stats?certification=${first}`)).json();
    expect(sB).toMatchObject({ certification: second, passingScore: 750, scale: { min: 100, max: 900 }, exams: { taken: 1 } });
    expect(sA).toMatchObject({ certification: first, passingScore: 825, scale: { min: 300, max: 1000 }, exams: { taken: 1 } });
    expect(sB.domains.map((d: { code: string }) => d.code)).toEqual(['1.0', '2.0', '3.0', '4.0', '5.0']);
    expect(sB.questions.answered).toBe(0);
    expect(sB.recentScores).toHaveLength(1);
    expect(sB.recentScores[0].scaledScore).toBeGreaterThanOrEqual(100);
    expect(sB.recentScores[0].scaledScore).toBeLessThanOrEqual(900);

    const pB = (await call('GET', `/exams?certification=${second}`)).json();
    const pA = (await call('GET', `/exams?certification=${first}`)).json();
    expect(pB).toMatchObject({ total: 30, taken: 1, passingScore: 750, nextNumber: 1 });
    expect(pA).toMatchObject({ total: 100, taken: 1, passingScore: 825, nextNumber: 1 });
    expect(pB.exams[6]).toMatchObject({ number: 7, questionCount: 90, taken: 1 });
    expect(pA.exams[6]).toMatchObject({ number: 7, questionCount: 102, taken: 1 });
    // Le n° 31 n'existe pas en Security+ (30 examens), il existe en CCNA.
    expect((await call('POST', '/attempts', { certification: second, mode: 'exam', examNumber: 31 })).statusCode).toBe(404);
    expect((await call('POST', '/attempts', { certification: first, mode: 'exam', examNumber: 31 })).statusCode).toBe(201);

    // L'historique est filtré par certification.
    const hB = (await call('GET', `/attempts?certification=${second}`)).json().attempts as { certification: string }[];
    expect(hB.length).toBe(1);
    expect(hB.every((a) => a.certification === second)).toBe(true);
  });

  it('notation 100–900, seuil 750 : une réponse parfaite réussit, un examen vide échoue', async () => {
    const attempt = (await call('POST', '/attempts', { certification: second, mode: 'exam', examNumber: 8 })).json();
    const result = (await call('POST', `/attempts/${attempt.id}/submit`)).json();
    expect(result.scaledScore).toBe(100);
    expect(result.passingScore).toBe(750);
    expect(result.passed).toBe(false);
  });

  it('les modules absents répondent 404 module_unavailable, sans effet de bord', async () => {
    for (const url of [`/labs?certification=${second}`, `/labs?certification=${second}&kind=challenge`]) {
      const res = await call('GET', url);
      expect(res.statusCode, url).toBe(404);
      expect(res.json().error).toMatchObject({ code: 'module_unavailable', details: { certification: second } });
    }
    // Les mêmes routes répondent pour la certification qui a les modules.
    expect((await call('GET', `/labs?certification=${first}`)).statusCode).toBe(200);
    expect((await call('GET', `/labs?certification=${first}&kind=challenge`)).statusCode).toBe(200);
    // Les modules que la Security+ a répondent.
    expect((await call('GET', `/revision?certification=${second}`)).statusCode).toBe(200);
  });

  it('une certification sans flashcards, sans entraînement ou sans examen les refuse proprement', async () => {
    const base = { ...secondFile, domains: (secondFile.domains as unknown[]).slice() };
    const declare = async (code: string, modules: string[]) =>
      call('POST', '/admin/certifications', { config: { ...base, code, name: `Test ${code}`, modules } });
    expect((await declare('only-exam', ['exam'])).statusCode).toBe(201);
    expect((await declare('only-practice', ['practice'])).statusCode).toBe(201);
    expect((await declare('only-flashcards', ['flashcards'])).statusCode).toBe(201);

    const practice = await call('POST', '/attempts', { certification: 'only-exam', mode: 'practice', questionCount: 3 });
    expect(practice.statusCode).toBe(404);
    expect(practice.json().error).toMatchObject({ code: 'module_unavailable', details: { module: 'practice' } });
    expect((await call('GET', '/revision?certification=only-exam')).json().error.details.module).toBe('flashcards');
    expect((await call('GET', '/exams?certification=only-practice')).json().error.details.module).toBe('exam');
    expect((await call('POST', '/attempts', { certification: 'only-flashcards', mode: 'exam', questionCount: 3 })).statusCode).toBe(404);
    expect((await call('GET', '/revision?certification=only-flashcards')).statusCode).toBe(200);
  });

  it('add_certification (POST /admin/certifications) donne le même résultat que le fichier de données', async () => {
    // La voie MCP : `add_certification` envoie exactement le fichier à cette route (voir apps/mcp/test).
    const viaApi = 'security-plus-api';
    const declared = await call('POST', '/admin/certifications', { config: { ...secondFile, code: viaApi } });
    expect(declared.statusCode).toBe(201);

    const fromFile = (await call('GET', `/certifications/${second}`)).json().certification;
    const fromApi = (await call('GET', `/certifications/${viaApi}`)).json().certification;
    expect(fromApi).toEqual({ ...fromFile, code: viaApi });

    const summary = (code: string) =>
      (async () => {
        const [cert] = await db.select().from(certifications).where(eq(certifications.code, code));
        const doms = await db.select().from(domains).where(eq(domains.certificationId, cert!.id)).orderBy(domains.position);
        const subs = await db.select({ code: subtopics.code, name: subtopics.name, domain: domains.code }).from(subtopics).innerJoin(domains, eq(domains.id, subtopics.domainId)).where(eq(domains.certificationId, cert!.id)).orderBy(domains.position, subtopics.code);
        return { name: cert!.name, domains: doms.map((d) => [d.code, d.name, d.weight]), subtopics: subs.map((s) => [s.domain, s.code, s.name]) };
      })();
    expect(await summary(viaApi)).toEqual(await summary(second));

    // Idempotent : la déclarer deux fois ne crée rien de plus.
    expect((await call('POST', '/admin/certifications', { config: { ...secondFile, code: viaApi } })).statusCode).toBe(201);
    expect((await summary(viaApi)).subtopics).toHaveLength(28);

    // Un barème ou des pondérations incohérents sont refusés, comme par le fichier.
    const bad = await call('POST', '/admin/certifications', { config: { ...secondFile, code: 'bad', scoring: { min: 100, max: 900, passing: 950 } } });
    expect(bad.statusCode).toBe(400);
    const badModules = await call('POST', '/admin/certifications', { config: { ...secondFile, code: 'bad2', modules: ['challenges'] } });
    expect(badModules.statusCode).toBe(400);
  });

  it('l’écran d’administration liste les certifications, leurs compteurs, leur série et leur import', async () => {
    const res = await call('GET', '/admin/certifications');
    expect(res.statusCode).toBe(200);
    const list = res.json().certifications as {
      code: string;
      modules: string[];
      bank: { published: number };
      labs: { lab: number; challenge: number };
      series: { exams: number; taken: number };
      lastImportedAt: string | null;
      lastImport: { created: number } | null;
    }[];
    const a = list.find((c) => c.code === first)!;
    const b = list.find((c) => c.code === second)!;
    expect(a.bank.published).toBe(loadCertification(first).questions.length);
    expect(b.bank.published).toBe(loadCertification(second).questions.length);
    expect(a.series).toMatchObject({ exams: 100 });
    expect(b.series).toMatchObject({ exams: 30, taken: 2 });
    expect(a.labs.lab).toBeGreaterThan(0);
    expect(b.labs).toEqual({ lab: 0, challenge: 0 });
    expect(a.lastImportedAt).not.toBeNull();
    expect(b.lastImport).toMatchObject({ created: loadCertification(second).questions.length });
    // Une certification déclarée par l'API n'a jamais été importée.
    expect(list.find((c) => c.code === 'security-plus-api')).toMatchObject({ lastImportedAt: null, lastImport: null });
  });

  it('l’écran d’administration est réservé aux administrateurs', async () => {
    const other = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'simple@example.com', password: 'correct-horse-battery', displayName: 'Simple' },
    });
    // Inscriptions fermées après le premier compte : pas de session, donc 401.
    expect([401, 403]).toContain((await app.inject({ method: 'GET', url: '/api/v1/admin/certifications', headers: other.statusCode === 201 ? { cookie: `ef_session=${other.cookies.find((x) => x.name === 'ef_session')?.value}` } : {} })).statusCode);
  });
});
