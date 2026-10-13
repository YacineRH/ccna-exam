import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AnswerKey, CertificationConfig, QuestionBody, Response } from '@examforge/core';

/*
 * Le moteur ne connaît que des certifications, domaines et questions génériques.
 * Toute la spécificité du CCNA vit dans les lignes de ces tables, jamais dans le schéma.
 */

export const userRole = pgEnum('user_role', ['user', 'admin']);
export const questionStatus = pgEnum('question_status', ['draft', 'validated', 'published', 'retired']);
export const questionSource = pgEnum('question_source', ['manual', 'import', 'ai']);
export const attemptMode = pgEnum('attempt_mode', ['exam', 'practice']);
export const attemptStatus = pgEnum('attempt_status', ['in_progress', 'submitted', 'expired']);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    role: userRole('role').notNull().default('user'),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`)],
);

export const certifications = pgTable('certifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  vendor: text('vendor').notNull(),
  examCode: text('exam_code').notNull(),
  /** Configuration complète validée par le moteur (domaines, barème, format). */
  config: jsonb('config').$type<CertificationConfig>().notNull(),
  active: boolean('active').notNull().default(true),
  ...timestamps,
});

export const domains = pgTable(
  'domains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    certificationId: uuid('certification_id')
      .notNull()
      .references(() => certifications.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    weight: numeric('weight', { precision: 5, scale: 4, mode: 'number' }).notNull(),
    position: integer('position').notNull(),
  },
  (t) => [uniqueIndex('domains_cert_code_idx').on(t.certificationId, t.code)],
);

export const subtopics = pgTable(
  'subtopics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    domainId: uuid('domain_id')
      .notNull()
      .references(() => domains.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
  },
  (t) => [uniqueIndex('subtopics_domain_code_idx').on(t.domainId, t.code)],
);

export const questions = pgTable(
  'questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    certificationId: uuid('certification_id')
      .notNull()
      .references(() => certifications.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull().unique(),
    domainId: uuid('domain_id')
      .notNull()
      .references(() => domains.id),
    subtopicId: uuid('subtopic_id').references(() => subtopics.id),
    type: text('type').notNull(),
    difficulty: text('difficulty').notNull(),
    /** Énoncé public : seul ce champ est envoyé au candidat pendant un examen. */
    body: jsonb('body').$type<QuestionBody>().notNull(),
    /** Correction : ne quitte jamais le serveur avant la soumission. */
    answerKey: jsonb('answer_key').$type<AnswerKey>().notNull(),
    explanation: text('explanation').notNull(),
    distractorNotes: jsonb('distractor_notes').$type<Record<string, string>>().notNull().default({}),
    reference: text('reference'),
    /** Empreinte de l'énoncé normalisé, pour refuser les doublons. */
    contentHash: text('content_hash').notNull(),
    status: questionStatus('status').notNull().default('published'),
    source: questionSource('source').notNull().default('manual'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('questions_cert_hash_idx').on(t.certificationId, t.contentHash),
    index('questions_pool_idx').on(t.certificationId, t.status, t.domainId),
  ],
);

/** Les ~100 examens blancs figés : chaque candidat passant l'examen n°12 a les mêmes questions. */
export const exams = pgTable(
  'exams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    certificationId: uuid('certification_id')
      .notNull()
      .references(() => certifications.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    seed: integer('seed').notNull(),
    source: questionSource('source').notNull().default('manual'),
    ...timestamps,
  },
  (t) => [uniqueIndex('exams_cert_number_idx').on(t.certificationId, t.number)],
);

export const examQuestions = pgTable(
  'exam_questions',
  {
    examId: uuid('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id),
    position: integer('position').notNull(),
  },
  (t) => [
    // Une question n'apparaît qu'une fois par examen : garanti par la base, pas seulement par le code.
    primaryKey({ columns: [t.examId, t.questionId] }),
    uniqueIndex('exam_questions_position_idx').on(t.examId, t.position),
  ],
);

export const attempts = pgTable(
  'attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    certificationId: uuid('certification_id')
      .notNull()
      .references(() => certifications.id),
    examId: uuid('exam_id').references(() => exams.id),
    mode: attemptMode('mode').notNull(),
    status: attemptStatus('status').notNull().default('in_progress'),
    seed: integer('seed').notNull(),
    allowBackNavigation: boolean('allow_back_navigation').notNull(),
    /** Position la plus avancée atteinte, pour interdire le retour arrière en mode examen. */
    furthestPosition: integer('furthest_position').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    correctCount: integer('correct_count'),
    totalCount: integer('total_count').notNull(),
    scaledScore: integer('scaled_score'),
    passed: boolean('passed'),
    domainScores: jsonb('domain_scores').$type<{ domain: string; correct: number; total: number; percent: number }[]>(),
  },
  (t) => [
    index('attempts_user_idx').on(t.userId, t.startedAt),
    check('attempts_total_positive', sql`${t.totalCount} > 0`),
  ],
);

export const attemptAnswers = pgTable(
  'attempt_answers',
  {
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id),
    position: integer('position').notNull(),
    response: jsonb('response').$type<Response>(),
    flagged: boolean('flagged').notNull().default(false),
    secondsSpent: integer('seconds_spent').notNull().default(0),
    isCorrect: boolean('is_correct'),
    partial: real('partial'),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.attemptId, t.questionId] }),
    uniqueIndex('attempt_answers_position_idx').on(t.attemptId, t.position),
  ],
);

export type User = typeof users.$inferSelect;
export type Attempt = typeof attempts.$inferSelect;
