import { and, asc, count, eq, max } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  assembleExam,
  certificationSchema,
  createRng,
  DIFFICULTIES,
  InsufficientQuestionsError,
  questionSchema,
  type PoolQuestion,
} from '@examforge/core';
import { checkQuestionAgainstCertification } from '@examforge/content';
import type { Db } from '../db/client.js';
import { certifications, domains, examQuestions, exams, questions, subtopics } from '../db/schema.js';
import { badRequest, conflict, notFound, parseInput } from '../errors.js';
import { DuplicateQuestionError, upsertCertification, upsertQuestion } from '../services/content-sync.js';

/*
 * Routes d'administration, utilisées par le serveur MCP (jeton de service) ou un admin.
 * Le MCP ne touche jamais la base directement : tout passe par ces règles de validation.
 *
 * Cycle d'une question générée : soumise -> validée automatiquement (schéma, cohérence,
 * doublons) -> relue par une seconde passe -> publiée. Seules les questions publiées
 * entrent dans les examens.
 */

const submitSchema = z.object({
  question: z.unknown(),
  source: z.enum(['manual', 'import', 'ai']).default('ai'),
});
const reviewSchema = z.object({
  approved: z.boolean(),
  issues: z.array(z.string().max(500)).max(20).default([]),
});
const listQuery = z.object({
  certification: z.string(),
  domain: z.string().optional(),
  subtopic: z.string().optional(),
  status: z.enum(['draft', 'validated', 'published', 'retired']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
const examSchema = z.object({
  certification: z.string(),
  questionCount: z.number().int().min(1).max(200).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  domains: z.array(z.string()).max(20).optional(),
  title: z.string().max(120).optional(),
});

async function certByCode(db: Db, code: string) {
  const [cert] = await db.select().from(certifications).where(eq(certifications.code, code));
  if (!cert) throw notFound(`Certification inconnue : ${code}`);
  return cert;
}

export function adminRoutes(db: Db) {
  return async (app: FastifyInstance) => {
    app.addHook('preHandler', async (req) => {
      await app.requireAdmin(req);
    });

    app.post('/certifications', async (req, reply) => {
      const body = parseInput(z.object({ config: z.unknown() }), req.body);
      const parsed = certificationSchema.safeParse(body.config);
      if (!parsed.success) throw badRequest('Configuration de certification invalide', parsed.error.issues.map((i) => i.message));
      const id = await upsertCertification(db, parsed.data);
      return reply.code(201).send({ id, code: parsed.data.code });
    });

    app.get('/questions', async (req) => {
      const q = parseInput(listQuery, req.query);
      const cert = await certByCode(db, q.certification);
      const rows = await db
        .select({
          slug: questions.slug,
          domain: domains.code,
          subtopic: subtopics.code,
          type: questions.type,
          difficulty: questions.difficulty,
          status: questions.status,
          stem: questions.body,
        })
        .from(questions)
        .innerJoin(domains, eq(domains.id, questions.domainId))
        .leftJoin(subtopics, eq(subtopics.id, questions.subtopicId))
        .where(
          and(
            eq(questions.certificationId, cert.id),
            q.domain ? eq(domains.code, q.domain) : undefined,
            q.subtopic ? eq(subtopics.code, q.subtopic) : undefined,
            q.status ? eq(questions.status, q.status) : undefined,
          ),
        )
        .orderBy(asc(questions.slug))
        .limit(q.limit);
      return { questions: rows.map(({ stem, ...r }) => ({ ...r, stem: stem.stem })) };
    });

    app.post('/questions', async (req, reply) => {
      const { question, source } = parseInput(submitSchema, req.body);
      const parsed = questionSchema.safeParse(question);
      if (!parsed.success) {
        throw badRequest('Question rejetée par la validation automatique', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
      }
      const q = parsed.data;
      const cert = await certByCode(db, q.certification);
      const issues = checkQuestionAgainstCertification(q, cert.config);
      if (issues.length) throw badRequest('Question mal rangée', issues);
      const [existing] = await db.select({ status: questions.status }).from(questions).where(eq(questions.slug, q.slug));
      if (existing?.status === 'published') throw conflict('already_published', `${q.slug} est déjà publiée : utilisez un nouveau slug`);
      try {
        // Validée automatiquement, mais pas encore publiée : il manque la relecture.
        const r = await upsertQuestion(db, cert.id, q, { status: 'validated', source });
        return reply.code(r.created ? 201 : 200).send({ id: r.id, slug: q.slug, status: 'validated' });
      } catch (err) {
        if (err instanceof DuplicateQuestionError) throw conflict('duplicate_question', err.message, { existing: err.existingSlug });
        throw err;
      }
    });

    app.get<{ Params: { slug: string } }>('/questions/:slug', async (req) => {
      const [row] = await db
        .select({ q: questions, domain: domains.code, subtopic: subtopics.code, certification: certifications.code })
        .from(questions)
        .innerJoin(domains, eq(domains.id, questions.domainId))
        .innerJoin(certifications, eq(certifications.id, questions.certificationId))
        .leftJoin(subtopics, eq(subtopics.id, questions.subtopicId))
        .where(eq(questions.slug, req.params.slug));
      if (!row) throw notFound(`Question inconnue : ${req.params.slug}`);
      const { q } = row;
      return {
        slug: q.slug,
        certification: row.certification,
        domain: row.domain,
        subtopic: row.subtopic,
        difficulty: q.difficulty,
        status: q.status,
        source: q.source,
        body: q.body,
        key: q.answerKey,
        explanation: q.explanation,
        distractorNotes: q.distractorNotes,
        reference: q.reference,
      };
    });

    app.post<{ Params: { slug: string } }>('/questions/:slug/review', async (req) => {
      const { approved, issues } = parseInput(reviewSchema, req.body);
      const [row] = await db.select({ id: questions.id, status: questions.status }).from(questions).where(eq(questions.slug, req.params.slug));
      if (!row) throw notFound(`Question inconnue : ${req.params.slug}`);
      if (approved && row.status !== 'validated' && row.status !== 'published') {
        throw conflict('not_validated', 'Seule une question validée automatiquement peut être publiée');
      }
      const status = approved ? 'published' : 'draft';
      await db.update(questions).set({ status, updatedAt: new Date() }).where(eq(questions.id, row.id));
      return { slug: req.params.slug, status, issues };
    });

    app.post('/exams', async (req, reply) => {
      const input = parseInput(examSchema, req.body);
      const cert = await certByCode(db, input.certification);
      const pool = (await db
        .select({ id: questions.id, domain: domains.code, type: questions.type, difficulty: questions.difficulty })
        .from(questions)
        .innerJoin(domains, eq(domains.id, questions.domainId))
        .where(and(eq(questions.certificationId, cert.id), eq(questions.status, 'published')))) as PoolQuestion[];
      // Chaque examen figé pioche d'abord dans les questions encore jamais utilisées par les autres.
      const used = await db
        .selectDistinct({ id: examQuestions.questionId })
        .from(examQuestions)
        .innerJoin(exams, eq(exams.id, examQuestions.examId))
        .where(eq(exams.certificationId, cert.id));

      const [{ last } = { last: null }] = await db.select({ last: max(exams.number) }).from(exams).where(eq(exams.certificationId, cert.id));
      const number = (last ?? 0) + 1;
      const seed = Math.floor(createRng(number * 7919 + Date.now())() * 2 ** 31);

      let ids: string[];
      try {
        ids = assembleExam(pool, cert.config, {
          seed,
          ...(input.questionCount ? { questionCount: input.questionCount } : {}),
          ...(input.difficulty ? { difficulty: input.difficulty } : {}),
          ...(input.domains?.length ? { domains: input.domains } : {}),
          avoidIds: used.map((u) => u.id),
        });
      } catch (err) {
        if (err instanceof InsufficientQuestionsError) {
          throw conflict('insufficient_questions', err.message, { domain: err.domain, needed: err.needed, available: err.available });
        }
        throw err;
      }
      const fresh = ids.filter((id) => !used.some((u) => u.id === id)).length;

      const exam = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(exams)
          .values({ certificationId: cert.id, number, seed, title: input.title ?? `Examen blanc #${number}`, source: 'ai' })
          .returning();
        await tx.insert(examQuestions).values(ids.map((questionId, position) => ({ examId: created!.id, questionId, position })));
        return created!;
      });
      return reply.code(201).send({ number: exam.number, title: exam.title, questionCount: ids.length, freshQuestions: fresh });
    });

    app.get('/exams', async (req) => {
      const { certification } = parseInput(z.object({ certification: z.string() }), req.query);
      const cert = await certByCode(db, certification);
      const rows = await db
        .select({ number: exams.number, title: exams.title, questions: count(examQuestions.questionId) })
        .from(exams)
        .leftJoin(examQuestions, eq(examQuestions.examId, exams.id))
        .where(eq(exams.certificationId, cert.id))
        .groupBy(exams.number, exams.title)
        .orderBy(asc(exams.number));
      return { exams: rows };
    });
  };
}
