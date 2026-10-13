import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnswerKey, Response } from '@examforge/core';
import { loadCertification } from '@examforge/content';
import { buildApp } from '../src/app.js';
import { createDb, type Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { questions } from '../src/db/schema.js';
import { seedContent } from '../src/db/seed.js';
import { loadEnv } from '../src/env.js';
import { DuplicateQuestionError, upsertQuestion } from '../src/services/content-sync.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;

/** Réponse parfaite à partir de la correction stockée en base. */
function perfect(key: AnswerKey): Response {
  switch (key.type) {
    case 'mcq_single':
      return { type: 'mcq_single', choice: key.correct };
    case 'mcq_multi':
      return { type: 'mcq_multi', choices: key.correct };
    case 'fill_blank':
      return { type: 'fill_blank', fields: Object.fromEntries(Object.entries(key.fields).map(([k, f]) => [k, f.accepted[0]!])) };
    case 'cli':
      return { type: 'cli', lines: key.commands.map((c) => c[0]!) };
    case 'ordering':
      return { type: 'ordering', order: key.order };
    case 'matching':
      return { type: 'matching', pairs: key.pairs };
  }
}

describe.skipIf(!DATABASE_URL)('API v1 (PostgreSQL)', () => {
  let app: FastifyInstance;
  let db: Db;
  let pool: pg.Pool;
  let adminCookie = '';

  const call = async (method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown, cookie = adminCookie) =>
    app.inject({ method, url, payload: body as object, headers: cookie ? { cookie } : {} });
  const sessionCookie = (res: { cookies: { name: string; value: string }[] }) => {
    const c = res.cookies.find((x) => x.name === 'ef_session');
    return c ? `ef_session=${c.value}` : '';
  };
  const keyOf = async (questionId: string) => {
    const [row] = await db.select({ key: questions.answerKey }).from(questions).where(eq(questions.id, questionId));
    return row!.key;
  };

  beforeAll(async () => {
    ({ db, pool } = createDb(DATABASE_URL!));
    await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
    await runMigrations(db);
    await seedContent(db);
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: DATABASE_URL!,
      JWT_SECRET: 'x'.repeat(40),
      SERVICE_TOKEN: 's'.repeat(40),
    });
    app = await buildApp(env, db);
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it('répond au health check', async () => {
    const res = await call('GET', '/api/v1/health');
    expect(res.statusCode).toBe(200);
  });

  it('le premier compte devient admin, les inscriptions suivantes sont fermées', async () => {
    const res = await call('POST', '/api/v1/auth/register', { email: 'Yacine@Example.com', password: 'correct-horse-battery', displayName: 'Yacine' }, '');
    expect(res.statusCode).toBe(201);
    expect(res.json().user.role).toBe('admin');
    adminCookie = sessionCookie(res);
    expect(adminCookie).not.toBe('');
    const cookie = res.cookies.find((c) => c.name === 'ef_session');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Strict');

    const second = await call('POST', '/api/v1/auth/register', { email: 'autre@example.com', password: 'correct-horse-battery', displayName: 'Autre' }, '');
    expect(second.statusCode).toBe(403);
  });

  it('refuse un mauvais mot de passe et accepte le bon, sans tenir compte de la casse de l\'e-mail', async () => {
    const bad = await call('POST', '/api/v1/auth/login', { email: 'yacine@example.com', password: 'mauvais-mot-de-passe' }, '');
    expect(bad.statusCode).toBe(401);
    const unknown = await call('POST', '/api/v1/auth/login', { email: 'personne@example.com', password: 'mauvais-mot-de-passe' }, '');
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().error.message).toBe(bad.json().error.message);
    const good = await call('POST', '/api/v1/auth/login', { email: 'YACINE@example.com', password: 'correct-horse-battery' }, '');
    expect(good.statusCode).toBe(200);
  });

  it('exige une session pour les routes protégées', async () => {
    expect((await call('GET', '/api/v1/auth/me', undefined, '')).statusCode).toBe(401);
    expect((await call('GET', '/api/v1/attempts', undefined, '')).statusCode).toBe(401);
    expect((await call('GET', '/api/v1/auth/me')).json().user.email).toBe('yacine@example.com');
  });

  it('accepte le jeton de service du serveur MCP', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${'s'.repeat(40)}` } });
    expect(res.statusCode).toBe(200);
    const bad = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${'t'.repeat(40)}` } });
    expect(bad.statusCode).toBe(401);
  });

  it('expose la certification et l\'état de la banque', async () => {
    const list = await call('GET', '/api/v1/certifications');
    expect(list.json().certifications.map((c: { code: string }) => c.code)).toContain('ccna');
    const detail = (await call('GET', '/api/v1/certifications/ccna')).json();
    expect(detail.certification.scoring.passing).toBe(825);
    expect(detail.bank.questions).toBe(loadCertification('ccna').questions.length);
    expect((await call('GET', '/api/v1/certifications/inconnue')).statusCode).toBe(404);
  });

  it('refuse un doublon d\'énoncé sous un autre slug', async () => {
    const { questions: bank } = loadCertification('ccna');
    const original = bank[0]!;
    const certId = ((await db.execute(sql`select id from certifications where code = 'ccna'`)).rows[0] as { id: string }).id;
    await expect(
      upsertQuestion(db, certId, { ...original, slug: `${original.slug}-copie`, body: { ...original.body, stem: `  ${original.body.stem.toUpperCase()} ` } }),
    ).rejects.toBeInstanceOf(DuplicateQuestionError);
  });

  it('mode examen : pas de correction avant la fin, pas de retour arrière, notation au barème', async () => {
    const start = await call('POST', '/api/v1/attempts', { certification: 'ccna', mode: 'exam', questionCount: 10 });
    expect(start.statusCode).toBe(201);
    const state = start.json();
    expect(state.questions).toHaveLength(10);
    expect(state.deadlineAt).not.toBeNull();
    // Aucune correction ne doit transiter vers le navigateur pendant l'examen.
    expect(JSON.stringify(state)).not.toMatch(/"key"|"answerKey"|"correct"|"accepted"|"explanation"/);

    const [q0, q1, q2] = state.questions as { id: string; position: number; body: { type: string } }[];
    const answer = async (q: { id: string }, response: Response) =>
      call('PUT', `/api/v1/attempts/${state.id}/answers/${q.id}`, { response, secondsSpent: 40 });

    expect((await answer(q0!, perfect(await keyOf(q0!.id)))).json()).toEqual({ saved: true });
    expect((await answer(q2!, perfect(await keyOf(q2!.id)))).statusCode).toBe(200);
    const back = await answer(q1!, perfect(await keyOf(q1!.id)));
    expect(back.statusCode).toBe(409);
    expect(back.json().error.code).toBe('back_navigation_forbidden');

    const wrongType = await call('PUT', `/api/v1/attempts/${state.id}/answers/${q2!.id}`, {
      response: q2!.body.type === 'ordering' ? { type: 'mcq_single', choice: 'a' } : { type: 'ordering', order: ['a', 'b'] },
    });
    expect(wrongType.json().error.code).toBe('response_type_mismatch');

    expect((await call('GET', `/api/v1/attempts/${state.id}/result`)).statusCode).toBe(409);
    const result = (await call('POST', `/api/v1/attempts/${state.id}/submit`)).json();
    expect(result.status).toBe('submitted');
    expect(result.correctCount).toBe(2);
    expect(result.totalCount).toBe(10);
    expect(result.scaledScore).toBeGreaterThanOrEqual(300);
    expect(result.scaledScore).toBeLessThan(825);
    expect(result.passed).toBe(false);
    expect(result.review[0].key).toBeDefined();
    expect(result.review[0].explanation).toBeDefined();

    const closed = await answer(q2!, perfect(await keyOf(q2!.id)));
    expect(closed.json().error.code).toBe('attempt_closed');
  });

  it('mode entraînement : correction immédiate', async () => {
    const state = (await call('POST', '/api/v1/attempts', { certification: 'ccna', mode: 'practice', questionCount: 3, domains: ['5.0'] })).json();
    expect(state.deadlineAt).toBeNull();
    expect(state.questions.every((q: { domain: string }) => q.domain === '5.0')).toBe(true);
    const q = state.questions[0];
    const res = (await call('PUT', `/api/v1/attempts/${state.id}/answers/${q.id}`, { response: perfect(await keyOf(q.id)) })).json();
    expect(res.feedback.correct).toBe(true);
    expect(res.feedback.explanation.length).toBeGreaterThan(10);
  });

  it('signale une banque insuffisante au lieu de répéter des questions', async () => {
    const res = await call('POST', '/api/v1/attempts', { certification: 'ccna', mode: 'exam' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('insufficient_questions');
  });

  it('calcule les statistiques du tableau de bord', async () => {
    const stats = (await call('GET', '/api/v1/stats?certification=ccna')).json();
    expect(stats.passingScore).toBe(825);
    expect(stats.exams.taken).toBe(1);
    expect(stats.recentScores).toHaveLength(1);
    expect(stats.readiness.estimate).toBe(stats.recentScores[0].scaledScore);
    expect(stats.readiness.level).toBe('not_ready');
    expect(stats.domains).toHaveLength(6);
    // 10 questions d'examen notées + 1 réponse d'entraînement.
    expect(stats.questions.answered).toBe(11);
    expect(stats.questions.correct).toBe(3);
    expect(stats.toReview.length).toBeGreaterThan(0);
    expect(stats.toReview[0].errors).toBeGreaterThan(0);
    expect((await call('GET', '/api/v1/stats')).statusCode).toBe(400);
  });

  describe('administration (serveur MCP)', () => {
    const service = { authorization: `Bearer ${'s'.repeat(40)}` };
    const admin = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
      app.inject({ method, url: `/api/v1/admin${url}`, payload: payload as object, headers: service });
    const generated = {
      slug: 'ccna-4.2-ntp-stratum-ai-001',
      certification: 'ccna',
      domain: '4.0',
      subtopic: '4.2',
      difficulty: 'easy',
      body: {
        type: 'mcq_single',
        stem: 'Que signifie un stratum NTP plus élevé pour une source de temps ?',
        options: [
          { id: 'a', text: 'Elle est plus éloignée de l\'horloge de référence.' },
          { id: 'b', text: 'Elle est plus précise.' },
          { id: 'c', text: 'Elle utilise un port différent.' },
        ],
      },
      key: { type: 'mcq_single', correct: 'a' },
      explanation: 'Le stratum compte le nombre de sauts depuis l\'horloge de référence (stratum 0).',
      distractorNotes: { b: 'Plus loin de la référence signifie en général moins précis.', c: 'NTP utilise toujours UDP 123.' },
    };

    it('refuse les non-administrateurs', async () => {
      const user = await app.jwt.sign({ sub: '00000000-0000-0000-0000-000000000000', role: 'user' });
      const res = await app.inject({ method: 'GET', url: '/api/v1/admin/questions?certification=ccna', headers: { cookie: `ef_session=${user}` } });
      expect(res.statusCode).toBe(403);
    });

    it('rejette une question incohérente avec le détail des erreurs', async () => {
      const res = await admin('POST', '/questions', { question: { ...generated, key: { type: 'mcq_single', correct: 'z' } } });
      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(res.json().error.details)).toContain('réponse z absente des options');
      const misplaced = await admin('POST', '/questions', { question: { ...generated, subtopic: '5.6' } });
      expect(misplaced.statusCode).toBe(400);
    });

    it('double passe : validée automatiquement, puis publiée après relecture', async () => {
      const submitted = await admin('POST', '/questions', { question: generated });
      expect(submitted.statusCode).toBe(201);
      expect(submitted.json().status).toBe('validated');

      // Pas encore utilisable dans un examen.
      const before = (await call('GET', '/api/v1/certifications/ccna')).json().bank.byDomain['4.0'];

      const full = (await admin('GET', `/questions/${generated.slug}`)).json();
      expect(full.key).toEqual({ type: 'mcq_single', correct: 'a' });

      const reviewed = await admin('POST', `/questions/${generated.slug}/review`, { approved: true });
      expect(reviewed.json().status).toBe('published');
      const after = (await call('GET', '/api/v1/certifications/ccna')).json().bank.byDomain['4.0'];
      expect(after).toBe(before + 1);

      const again = await admin('POST', '/questions', { question: generated });
      expect(again.json().error.code).toBe('already_published');
      const twin = await admin('POST', '/questions', { question: { ...generated, slug: 'ccna-4.2-ntp-stratum-ai-002' } });
      expect(twin.json().error.code).toBe('duplicate_question');
    });

    it('assemble des examens figés numérotés et signale les manques', async () => {
      const first = await admin('POST', '/exams', { certification: 'ccna', questionCount: 6 });
      expect(first.statusCode).toBe(201);
      expect(first.json()).toMatchObject({ number: 1, questionCount: 6, freshQuestions: 6 });
      const second = (await admin('POST', '/exams', { certification: 'ccna', questionCount: 6 })).json();
      expect(second.number).toBe(2);
      expect(second.freshQuestions).toBe(6);
      const list = (await admin('GET', '/exams?certification=ccna')).json().exams;
      expect(list.map((e: { number: number }) => e.number)).toEqual([1, 2]);

      const short = await admin('POST', '/exams', { certification: 'ccna' });
      expect(short.json().error.code).toBe('insufficient_questions');

      const attempt = await call('POST', '/api/v1/attempts', { certification: 'ccna', mode: 'exam', examNumber: 1 });
      expect(attempt.statusCode).toBe(201);
      expect(attempt.json().totalCount).toBe(6);
    });

    it('déclare une nouvelle certification par simple configuration', async () => {
      const config = {
        code: 'secplus',
        name: 'CompTIA Security+',
        vendor: 'CompTIA',
        examCode: 'SY0-701',
        domains: [
          { code: '1.0', name: 'General Security Concepts', weight: 0.12 },
          { code: '2.0', name: 'Threats, Vulnerabilities, and Mitigations', weight: 0.22 },
          { code: '3.0', name: 'Security Architecture', weight: 0.18 },
          { code: '4.0', name: 'Security Operations', weight: 0.28 },
          { code: '5.0', name: 'Security Program Management and Oversight', weight: 0.2 },
        ],
        scoring: { min: 100, max: 900, passing: 750 },
        examFormat: { questionCount: 90, durationMinutes: 90, allowBackNavigation: true },
        allowedQuestionTypes: ['mcq_single', 'mcq_multi', 'ordering', 'matching'],
      };
      expect((await admin('POST', '/certifications', { config })).statusCode).toBe(201);
      const bad = await admin('POST', '/certifications', { config: { ...config, domains: config.domains.slice(1) } });
      expect(bad.statusCode).toBe(400);
      const list = (await call('GET', '/api/v1/certifications')).json().certifications.map((c: { code: string }) => c.code);
      expect(list).toEqual(['ccna', 'secplus']);
    });
  });

  it('isole les tentatives entre utilisateurs', async () => {
    const mine = (await call('GET', '/api/v1/attempts')).json().attempts;
    expect(mine.length).toBeGreaterThanOrEqual(2);
    const forged = await app.jwt.sign({ sub: '00000000-0000-0000-0000-000000000000', role: 'user' });
    const res = await call('GET', `/api/v1/attempts/${mine[0].id}`, undefined, `ef_session=${forged}`);
    expect(res.statusCode).toBe(403);
  });
});
