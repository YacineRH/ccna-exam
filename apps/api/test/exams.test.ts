import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCertification, parseQuestion, type ExamSeries, type Question } from '@examforge/core';
import { loadCertification, loadExamSeries } from '@examforge/content';
import { buildApp } from '../src/app.js';
import { createDb, type Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { certifications, examQuestions, exams, questions } from '../src/db/schema.js';
import { seedContent } from '../src/db/seed.js';
import { loadEnv } from '../src/env.js';
import { syncExamSeries, syncQuestions, upsertCertification } from '../src/services/content-sync.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)('API v1 : série d’examens blancs figés (PostgreSQL)', () => {
  let app: FastifyInstance;
  let db: Db;
  let pool: pg.Pool;
  let cookie = '';
  const series = loadExamSeries('ccna');

  const call = async (method: 'GET' | 'POST', url: string, body?: unknown, as = cookie) =>
    app.inject({ method, url: `/api/v1${url}`, payload: body as object, headers: as ? { cookie: as } : {} });

  /** Questions d'un examen figé, dans l'ordre, lues en base. */
  const examQuestionSlugs = async (certCode: string, number: number) => {
    const rows = await db
      .select({ slug: questions.slug })
      .from(examQuestions)
      .innerJoin(exams, eq(exams.id, examQuestions.examId))
      .innerJoin(certifications, eq(certifications.id, exams.certificationId))
      .innerJoin(questions, eq(questions.id, examQuestions.questionId))
      .where(sql`${certifications.code} = ${certCode} and ${exams.number} = ${number}`)
      .orderBy(asc(examQuestions.position));
    return rows.map((r) => r.slug);
  };

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
      payload: { email: 'serie@example.com', password: 'correct-horse-battery', displayName: 'Série' },
    });
    cookie = `ef_session=${reg.cookies.find((x) => x.name === 'ef_session')?.value}`;
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it('le contenu CCNA fournit une série de 100 examens', () => {
    expect(series?.exams).toHaveLength(100);
  });

  it('importe les 100 examens du contenu, sans jamais envoyer leurs questions dans la liste', async () => {
    const res = await call('GET', '/exams?certification=ccna');
    expect(res.statusCode).toBe(200);
    const progress = res.json();
    expect(progress).toMatchObject({ certification: 'ccna', total: 100, taken: 0, passed: 0, nextNumber: 1 });
    expect(progress.exams.map((e: { number: number }) => e.number)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(progress.exams[41]).toMatchObject({ number: 42, questionCount: 102, taken: 0, bestScore: null, inProgress: null });
    expect(JSON.stringify(progress)).not.toMatch(/answer_?key|"questions":\[/i);
    expect((await call('GET', '/exams?certification=ccna', undefined, '')).statusCode).toBe(401);
    expect((await call('GET', '/exams?certification=inconnue')).statusCode).toBe(404);
  });

  it('lance l’examen n° 42 par son numéro : ses 102 questions, dans l’ordre du fichier, au chrono officiel', async () => {
    const res = await call('POST', '/attempts', { certification: 'ccna', mode: 'exam', examNumber: 42 });
    expect(res.statusCode).toBe(201);
    const state = res.json();
    expect(state.totalCount).toBe(102);
    const slugs = await examQuestionSlugs('ccna', 42);
    expect(slugs).toEqual(series!.exams[41]!.questions);
    // La correction ne part jamais au navigateur avant la soumission.
    expect(JSON.stringify(state)).not.toMatch(/"(correct|accepted|commands|order|pairs)"/);

    const progress = (await call('GET', '/exams?certification=ccna')).json();
    expect(progress.exams[41].inProgress).toBe(state.id);
    expect(progress.taken).toBe(0);
    expect(progress.nextNumber).toBe(1);

    const submitted = await call('POST', `/attempts/${state.id}/submit`);
    expect(submitted.statusCode).toBe(200);
    const after = (await call('GET', '/exams?certification=ccna')).json();
    expect(after).toMatchObject({ taken: 1, nextNumber: 1 });
    expect(after.exams[41]).toMatchObject({ number: 42, taken: 1, inProgress: null });
    expect(after.exams[41].bestScore).toBeGreaterThanOrEqual(300);
    expect(after.exams[41].lastAt).not.toBeNull();
  });

  it('le prochain examen jamais commencé suit les numéros', async () => {
    const first = (await call('POST', '/attempts', { certification: 'ccna', mode: 'exam', examNumber: 1 })).json();
    await call('POST', `/attempts/${first.id}/submit`);
    expect((await call('GET', '/exams?certification=ccna')).json()).toMatchObject({ taken: 2, nextNumber: 2 });
  });

  it('un examen figé est identique d’un passage à l’autre', async () => {
    const order = async () => {
      const state = (await call('POST', '/attempts', { certification: 'ccna', mode: 'exam', examNumber: 42 })).json();
      await call('POST', `/attempts/${state.id}/submit`);
      return (state.questions as { id: string }[]).map((q) => q.id);
    };
    const a = await order();
    const b = await order();
    expect(a).toHaveLength(102);
    expect(b).toEqual(a);
  });

  it('un nouvel import ne crée ni doublon ni examen et ne change pas un examen passé', async () => {
    const before = await examQuestionSlugs('ccna', 42);
    const [{ n: examsBefore }] = (await db.execute(sql`select count(*)::int as n from exams`)).rows as { n: number }[];
    const [{ n: questionsBefore }] = (await db.execute(sql`select count(*)::int as n from questions`)).rows as { n: number }[];
    await seedContent(db);
    const [{ n: examsAfter }] = (await db.execute(sql`select count(*)::int as n from exams`)).rows as { n: number }[];
    const [{ n: questionsAfter }] = (await db.execute(sql`select count(*)::int as n from questions`)).rows as { n: number }[];
    expect(examsAfter).toBe(examsBefore);
    expect(questionsAfter).toBe(questionsBefore);
    expect(await examQuestionSlugs('ccna', 42)).toEqual(before);
  });

  describe('règles d’import d’une série', () => {
    // Une petite certification isolée, pour modifier la série sans toucher à celle du CCNA.
    const cert = parseCertification({
      code: 'serie-test',
      name: 'Série de test',
      vendor: 'Test',
      examCode: 'S-1',
      domains: [{ code: 'A', name: 'Alpha', weight: 1, subtopics: [{ code: 'A1', name: 'a1' }] }],
      scoring: { min: 0, max: 100, passing: 50 },
      examFormat: { questionCount: 3, durationMinutes: 5, allowBackNavigation: false },
      allowedQuestionTypes: ['mcq_single'],
    });
    const bank: Question[] = Array.from({ length: 6 }, (_, i) =>
      parseQuestion({
        slug: `serie-test-a1-q${i}`,
        certification: 'serie-test',
        domain: 'A',
        subtopic: 'A1',
        difficulty: 'easy',
        source: 'ai',
        body: { type: 'mcq_single', stem: `Question de série numéro ${i} ?`, options: [{ id: 'a', text: `vrai ${i}` }, { id: 'b', text: `faux ${i}` }] },
        key: { type: 'mcq_single', correct: 'a' },
        explanation: 'Explication suffisamment longue pour le schéma.',
        distractorNotes: { b: 'faux' },
        reference: 'test',
      }),
    );
    const make = (exams: string[][]): ExamSeries => ({
      certification: 'serie-test',
      seed: 1,
      constraints: { maxUses: 2, maxOverlap: 1 },
      exams: exams.map((qs, i) => ({ number: i + 1, title: `Examen blanc n° ${i + 1}`, questions: qs })),
    });
    const s = (...ids: number[]) => ids.map((i) => `serie-test-a1-q${i}`);
    let certId = '';

    it('crée, puis ne refait rien au second import', async () => {
      certId = await upsertCertification(db, cert);
      expect(await syncQuestions(db, certId, bank)).toEqual({ created: 6, updated: 0, unchanged: 0 });
      expect(await syncQuestions(db, certId, bank)).toEqual({ created: 0, updated: 0, unchanged: 6 });
      const series = make([s(0, 1, 2), s(3, 4, 5)]);
      expect(await syncExamSeries(db, certId, series)).toEqual({ created: 2, updated: 0, unchanged: 0, frozen: [] });
      expect(await syncExamSeries(db, certId, series)).toEqual({ created: 0, updated: 0, unchanged: 2, frozen: [] });
    });

    it('ne change jamais un examen déjà passé, mais met à jour un examen jamais commencé', async () => {
      const state = (await call('POST', '/attempts', { certification: 'serie-test', mode: 'exam', examNumber: 1 })).json();
      expect(state.totalCount).toBe(3);
      await call('POST', `/attempts/${state.id}/submit`);

      const changed = make([s(2, 1, 0), s(5, 4, 3), s(0, 3, 5)]);
      expect(await syncExamSeries(db, certId, changed)).toEqual({ created: 1, updated: 1, unchanged: 0, frozen: [1] });
      expect(await examQuestionSlugs('serie-test', 1)).toEqual(s(0, 1, 2));
      expect(await examQuestionSlugs('serie-test', 2)).toEqual(s(5, 4, 3));
      expect(await examQuestionSlugs('serie-test', 3)).toEqual(s(0, 3, 5));
      // Rejoué, l'import garde l'examen passé et ne touche plus au reste.
      expect(await syncExamSeries(db, certId, changed)).toEqual({ created: 0, updated: 0, unchanged: 2, frozen: [1] });

      const again = (await call('POST', '/attempts', { certification: 'serie-test', mode: 'exam', examNumber: 1 })).json();
      expect((again.questions as { id: string }[]).map((q) => q.id)).toEqual((state.questions as { id: string }[]).map((q) => q.id));
    });

    it('refuse une série qui cite une question inconnue', async () => {
      await expect(syncExamSeries(db, certId, make([s(0, 1, 9)]))).rejects.toThrow(/question inconnue serie-test-a1-q9/);
    });
  });

  it('la banque importée porte la source de chaque question', async () => {
    const { questions: bank } = loadCertification('ccna');
    const ai = bank.filter((q) => q.source === 'ai').length;
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from questions q join certifications c on c.id = q.certification_id where c.code = 'ccna' and q.source = 'ai'`)).rows as { n: number }[];
    expect(n).toBe(ai);
  });
});
