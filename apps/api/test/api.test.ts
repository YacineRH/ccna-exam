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

/** Champs qui portent une correction : aucun ne doit apparaître dans l'état d'un examen en cours. */
const CORRECTION_FIELDS = ['key', 'answerKey', 'correct', 'accepted', 'explanation', 'distractorNotes', 'isCorrect', 'feedback'];

/** Tous les noms de propriétés d'un objet JSON, à toute profondeur. */
function propertyNames(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const v of value) propertyNames(v, out);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      propertyNames(v, out);
    }
  }
  return out;
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

  it('compte les questions publiées par type, par sous-thème et par domaine et type', async () => {
    const { certification, questions: bank } = loadCertification('ccna');
    const { bank: counts } = (await call('GET', '/api/v1/certifications/ccna')).json() as {
      bank: { questions: number; byType: Record<string, number>; bySubtopic: Record<string, number>; byDomainType: Record<string, Record<string, number>> };
    };
    const tally = (keyOf: (q: (typeof bank)[number]) => string | undefined) => {
      const out: Record<string, number> = {};
      for (const q of bank) {
        const k = keyOf(q);
        if (k) out[k] = (out[k] ?? 0) + 1;
      }
      return out;
    };
    expect(counts.byType).toEqual(tally((q) => q.body.type));
    // Tous les sous-thèmes de la configuration figurent, même sans question.
    const subtopicCodes = certification.domains.flatMap((d) => d.subtopics.map((s) => s.code));
    expect(Object.keys(counts.bySubtopic).sort()).toEqual([...subtopicCodes].sort());
    expect(counts.bySubtopic).toEqual({ ...Object.fromEntries(subtopicCodes.map((c) => [c, 0])), ...tally((q) => q.subtopic) });
    for (const d of certification.domains) {
      expect(counts.byDomainType[d.code]).toEqual(tally((q) => (q.domain === d.code ? q.body.type : undefined)));
    }
    expect(Object.values(counts.byType).reduce((a, b) => a + b, 0)).toBe(counts.questions);
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
    // Aucune correction ne doit transiter vers le navigateur pendant l'examen. On cherche des noms de
    // propriétés, pas des chaînes : une option d'identifiant « key » (ccna-4.8-commands-roles-001) n'est
    // pas une fuite, et une recherche dans le JSON sérialisé échouait sur 1 % des tirages (bloc 7).
    expect(propertyNames(state).filter((k) => CORRECTION_FIELDS.includes(k))).toEqual([]);

    const [q0, q1, q2] = state.questions as { id: string; position: number; body: { type: string } }[];
    const answer = async (q: { id: string }, response: Response) =>
      call('PUT', `/api/v1/attempts/${state.id}/answers/${q.id}`, { response, secondsSpent: 40 });

    const saved = (await answer(q0!, perfect(await keyOf(q0!.id)))).json();
    // En examen, rien d'autre que l'accusé d'enregistrement et l'heure du serveur.
    expect(Object.keys(saved).sort()).toEqual(['saved', 'serverNow']);
    expect(saved.saved).toBe(true);
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

  it('mode examen : une option d\'identifiant « key » n\'est pas une fuite de correction (régression du bloc 6)', async () => {
    // Cause de l'échec isolé du bloc 6 : la recherche de "key" dans le JSON sérialisé trouvait l'identifiant
    // d'une option. On force ici le tirage de cette question pour que le cas soit joué à chaque passage.
    const start = await call('POST', '/api/v1/attempts', { certification: 'ccna', mode: 'exam', subtopics: ['4.8'], types: ['matching'], questionCount: 1 });
    expect(start.statusCode).toBe(201);
    const state = start.json();
    const raw = JSON.stringify(state);
    expect(raw).toContain('"id":"key"');
    expect(propertyNames(state).filter((k) => CORRECTION_FIELDS.includes(k))).toEqual([]);
    // Laissée en cours : soumise, elle compterait dans les statistiques du test suivant.
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
    // La banque permet un examen complet : on demande plus de questions qu'un domaine n'en contient.
    const available = loadCertification('ccna').questions.filter((q) => q.domain === '4.0').length;
    const res = await call('POST', '/api/v1/attempts', { certification: 'ccna', mode: 'exam', domains: ['4.0'], questionCount: available + 1 });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('insufficient_questions');
    expect(res.json().error.details).toMatchObject({ domain: '4.0', needed: available + 1, available });
  });

  it('tire un examen blanc complet au format officiel', async () => {
    const { certification } = loadCertification('ccna');
    const res = await call('POST', '/api/v1/attempts', { certification: 'ccna', mode: 'exam' });
    expect(res.statusCode).toBe(201);
    const state = res.json();
    expect(state.questions).toHaveLength(certification.examFormat.questionCount);
    expect(new Set(state.questions.map((q: { id: string }) => q.id)).size).toBe(certification.examFormat.questionCount);
    expect((Date.parse(state.deadlineAt) - Date.parse(state.startedAt)) / 60_000).toBe(certification.examFormat.durationMinutes);
    // Abandonné sans réponse : il ne doit pas fausser les statistiques suivantes.
    await db.execute(sql`delete from attempts where id = ${state.id}`);
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

  it('expose la certification et l\'heure du serveur dans l\'état de la tentative', async () => {
    const before = Date.now();
    const state = (await call('POST', '/api/v1/attempts', { certification: 'ccna', mode: 'practice', questionCount: 1 })).json();
    expect(state.certification).toBe('ccna');
    const serverNow = Date.parse(state.serverNow);
    expect(state.serverNow).toBe(new Date(serverNow).toISOString());
    expect(serverNow).toBeGreaterThanOrEqual(before - 1000);
    expect(serverNow).toBeLessThanOrEqual(Date.now() + 1000);
    const again = (await call('GET', `/api/v1/attempts/${state.id}`)).json();
    expect(again.certification).toBe('ccna');
    expect(Date.parse(again.serverNow)).toBeGreaterThanOrEqual(serverNow);
    // Recalage léger du chrono : heure du serveur, échéance et statut, sans les questions.
    const clock = await call('GET', `/api/v1/attempts/${state.id}/clock`);
    expect(clock.statusCode).toBe(200);
    expect(Object.keys(clock.json()).sort()).toEqual(['deadlineAt', 'serverNow', 'status']);
    expect(Date.parse(clock.json().serverNow)).toBeGreaterThanOrEqual(serverNow);
    const forged = await app.jwt.sign({ sub: '00000000-0000-0000-0000-000000000000', role: 'user' });
    expect((await call('GET', `/api/v1/attempts/${state.id}/clock`, undefined, `ef_session=${forged}`)).statusCode).toBe(403);
  });

  it('filtre les questions par type (entraînement ciblé)', async () => {
    const { questions: bank } = loadCertification('ccna');
    const countOf = (types: string[]) => bank.filter((q) => types.includes(q.body.type)).length;

    const ordering = await call('POST', '/api/v1/attempts', { certification: 'ccna', mode: 'practice', questionCount: 1, types: ['ordering'] });
    expect(ordering.statusCode).toBe(201);
    expect(ordering.json().questions.map((q: { body: { type: string } }) => q.body.type)).toEqual(['ordering']);

    const mixed = (await call('POST', '/api/v1/attempts', { certification: 'ccna', mode: 'practice', questionCount: 2, types: ['matching', 'ordering'] })).json();
    expect(mixed.questions).toHaveLength(2);
    expect(mixed.questions.every((q: { body: { type: string } }) => ['matching', 'ordering'].includes(q.body.type))).toBe(true);

    const tooMany = await call('POST', '/api/v1/attempts', { certification: 'ccna', mode: 'practice', questionCount: countOf(['ordering']) + 1, types: ['ordering'] });
    expect(tooMany.statusCode).toBe(409);
    expect(tooMany.json().error.code).toBe('insufficient_questions');

    const unknown = await call('POST', '/api/v1/attempts', { certification: 'ccna', mode: 'practice', types: ['essay'] });
    expect(unknown.statusCode).toBe(400);
  });

  it('filtre les questions par sous-thème (révision ciblée)', async () => {
    const { questions: bank } = loadCertification('ccna');
    const slugsOf = async (state: { questions: { id: string }[] }) => {
      const ids = state.questions.map((q) => q.id);
      const rows = await db.select({ id: questions.id, slug: questions.slug }).from(questions);
      return rows.filter((r) => ids.includes(r.id)).map((r) => r.slug);
    };
    const inSubtopic = (code: string) => bank.filter((q) => q.subtopic === code);
    const target = inSubtopic('3.4');
    expect(target.length).toBeGreaterThanOrEqual(2);

    const res = await call('POST', '/api/v1/attempts', { certification: 'ccna', mode: 'practice', questionCount: 2, subtopics: ['3.4'] });
    expect(res.statusCode).toBe(201);
    const slugs = await slugsOf(res.json());
    expect(slugs).toHaveLength(2);
    expect(slugs.every((slug) => target.some((q) => q.slug === slug))).toBe(true);

    // Deux sous-thèmes de domaines différents, combinés avec un filtre de type.
    const both = await call('POST', '/api/v1/attempts', {
      certification: 'ccna',
      mode: 'practice',
      questionCount: 2,
      subtopics: ['1.6', '5.6'],
      types: ['fill_blank'],
    });
    expect(both.statusCode).toBe(201);
    const picked = (await slugsOf(both.json())).map((slug) => bank.find((q) => q.slug === slug)!);
    expect(picked.every((q) => ['1.6', '5.6'].includes(q.subtopic!) && q.body.type === 'fill_blank')).toBe(true);

    const tooMany = await call('POST', '/api/v1/attempts', { certification: 'ccna', mode: 'practice', questionCount: target.length + 1, subtopics: ['3.4'] });
    expect(tooMany.statusCode).toBe(409);
    expect(tooMany.json().error.details).toMatchObject({ domain: '3.0', available: target.length });

    const unknown = await call('POST', '/api/v1/attempts', { certification: 'ccna', mode: 'practice', questionCount: 1, subtopics: ['9.9'] });
    expect(unknown.statusCode).toBe(409);
    expect(unknown.json().error.details.domain).toBe('*');
    expect((await call('POST', '/api/v1/attempts', { certification: 'ccna', mode: 'practice', subtopics: [''] })).statusCode).toBe(400);
  });

  it('renvoie l\'heure du serveur à chaque enregistrement de réponse', async () => {
    const state = (await call('POST', '/api/v1/attempts', { certification: 'ccna', mode: 'practice', questionCount: 1 })).json();
    const q = state.questions[0];
    const before = Date.now();
    const flagged = (await call('PUT', `/api/v1/attempts/${state.id}/answers/${q.id}`, { flagged: true })).json();
    const answered = (await call('PUT', `/api/v1/attempts/${state.id}/answers/${q.id}`, { response: perfect(await keyOf(q.id)) })).json();
    for (const res of [flagged, answered]) {
      expect(res.serverNow).toBe(new Date(Date.parse(res.serverNow)).toISOString());
      expect(Date.parse(res.serverNow)).toBeGreaterThanOrEqual(before - 1000);
      expect(Date.parse(res.serverNow)).toBeLessThanOrEqual(Date.now() + 1000);
    }
    expect(answered.feedback.correct).toBe(true);
  });

  it('garde dans les résultats l\'ordre d\'affichage vu pendant la tentative', async () => {
    const state = (
      await call('POST', '/api/v1/attempts', { certification: 'ccna', mode: 'exam', questionCount: 6, types: ['mcq_single', 'mcq_multi', 'ordering', 'matching'] })
    ).json();
    type Body = { type: string; options?: { id: string }[]; items?: { id: string }[]; right?: { id: string }[]; left?: { id: string }[] };
    const shown = (b: Body) => (b.options ?? b.items ?? [...(b.left ?? []), ...(b.right ?? [])]).map((x) => x.id);
    const during = (await call('GET', `/api/v1/attempts/${state.id}`)).json().questions as { id: string; body: Body }[];

    // Le mélange doit être effectif, sinon le test ne prouverait rien.
    const original = new Map((await db.select({ id: questions.id, body: questions.body }).from(questions)).map((q) => [q.id, q.body as Body]));
    expect(during.some((q) => shown(q.body).join() !== shown(original.get(q.id)!).join())).toBe(true);

    await call('POST', `/api/v1/attempts/${state.id}/submit`);
    const result = (await call('GET', `/api/v1/attempts/${state.id}/result`)).json();
    const after = new Map((result.review as { questionId: string; body: Body }[]).map((r) => [r.questionId, r.body]));
    for (const q of during) expect(shown(after.get(q.id)!)).toEqual(shown(q.body));
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

    it('assemble des examens figés numérotés à la suite de la série et signale les manques', async () => {
      // La série du contenu (100 examens) est importée au démarrage : les examens du MCP viennent après.
      const before = (await admin('GET', '/exams?certification=ccna')).json().exams as { number: number }[];
      const last = before.at(-1)?.number ?? 0;
      const first = await admin('POST', '/exams', { certification: 'ccna', questionCount: 6 });
      expect(first.statusCode).toBe(201);
      expect(first.json()).toMatchObject({ number: last + 1, questionCount: 6 });
      const second = (await admin('POST', '/exams', { certification: 'ccna', questionCount: 6 })).json();
      expect(second.number).toBe(last + 2);
      const list = (await admin('GET', '/exams?certification=ccna')).json().exams;
      expect(list.map((e: { number: number }) => e.number).slice(-2)).toEqual([last + 1, last + 2]);

      const available = (await call('GET', '/api/v1/certifications/ccna')).json().bank.byDomain['6.0'] as number;
      const short = await admin('POST', '/exams', { certification: 'ccna', domains: ['6.0'], questionCount: available + 1 });
      expect(short.json().error.code).toBe('insufficient_questions');

      const attempt = await call('POST', '/api/v1/attempts', { certification: 'ccna', mode: 'exam', examNumber: last + 1 });
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
      expect(list).toEqual(['ccna', 'secplus', 'security-plus']);
      // Déclarée sans liste de modules : ceux qui ne demandent que des questions.
      const declared = (await call('GET', '/api/v1/certifications/secplus')).json().certification;
      expect(declared.modules).toEqual(['exam', 'practice', 'flashcards']);
    });
  });

  it('isole les tentatives entre utilisateurs', async () => {
    const mine = (await call('GET', '/api/v1/attempts')).json().attempts;
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect((await call('GET', '/api/v1/attempts?certification=ccna')).json().attempts).toHaveLength(mine.length);
    expect((await call('GET', '/api/v1/attempts?certification=secplus')).json().attempts).toEqual([]);
    const forged = await app.jwt.sign({ sub: '00000000-0000-0000-0000-000000000000', role: 'user' });
    const res = await call('GET', `/api/v1/attempts/${mine[0].id}`, undefined, `ef_session=${forged}`);
    expect(res.statusCode).toBe(403);
  });
});
