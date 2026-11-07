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
import type { AnswerKey, CertificationConfig, Lab, QuestionBody, Response } from '@examforge/core';

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

export const labAttemptStatus = pgEnum('lab_attempt_status', ['in_progress', 'finished']);
/** Lab guidé ou challenge chronométré : même format, même simulateur, même table de sessions. */
export const labKind = pgEnum('lab_kind', ['lab', 'challenge']);

/**
 * Labs CLI : la définition complète (état de départ, objectifs, indices, solution) est stockée d'un bloc.
 * Elle ne quitte jamais le serveur avant la fin d'une session : seule sa partie publique est envoyée.
 */
export const labs = pgTable(
  'labs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    certificationId: uuid('certification_id')
      .notNull()
      .references(() => certifications.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull().unique(),
    domainId: uuid('domain_id')
      .notNull()
      .references(() => domains.id),
    subtopicId: uuid('subtopic_id')
      .notNull()
      .references(() => subtopics.id),
    kind: labKind('kind').notNull().default('lab'),
    difficulty: text('difficulty').notNull(),
    title: text('title').notNull(),
    definition: jsonb('definition').$type<Lab>().notNull(),
    status: questionStatus('status').notNull().default('published'),
    source: questionSource('source').notNull().default('manual'),
    ...timestamps,
  },
  (t) => [index('labs_cert_status_idx').on(t.certificationId, t.status, t.kind)],
);

/** Une session de lab : les commandes sont rejouées dans l'ordre pour reconstituer l'état des équipements. */
export const labAttempts = pgTable(
  'lab_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    labId: uuid('lab_id')
      .notNull()
      .references(() => labs.id, { onDelete: 'cascade' }),
    status: labAttemptStatus('status').notNull().default('in_progress'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    /** Premier instant où tous les objectifs étaient atteints. */
    solvedAt: timestamp('solved_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** Tous les objectifs atteints à la fin de la session. */
    success: boolean('success'),
    hintsUsed: integer('hints_used').notNull().default(0),
    commandCount: integer('command_count').notNull().default(0),
    /** Challenge : échéance, contrôlée côté serveur comme celle d'un examen. */
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    /** Challenge terminé par l'échéance plutôt que par la réussite ou l'abandon. */
    expired: boolean('expired').notNull().default(false),
  },
  (t) => [index('lab_attempts_user_idx').on(t.userId, t.startedAt), index('lab_attempts_lab_idx').on(t.labId, t.userId)],
);

export const labAttemptCommands = pgTable(
  'lab_attempt_commands',
  {
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => labAttempts.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    device: text('device').notNull(),
    input: text('input').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.attemptId, t.seq] })],
);

/**
 * Révision espacée : une carte par utilisateur et par question (boîte de Leitner, échéance).
 * Le paquet d'un sous-thème est ajouté d'un coup ; les cartes sont ensuite dues une à une.
 */
export const reviewCards = pgTable(
  'review_cards',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    certificationId: uuid('certification_id')
      .notNull()
      .references(() => certifications.id, { onDelete: 'cascade' }),
    subtopicId: uuid('subtopic_id')
      .notNull()
      .references(() => subtopics.id),
    box: integer('box').notNull().default(0),
    intervalDays: integer('interval_days').notNull().default(0),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull().defaultNow(),
    reviews: integer('reviews').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.questionId] }), index('review_cards_due_idx').on(t.userId, t.certificationId, t.dueAt)],
);

/** Une session de révision : les cartes tirées, dans l'ordre, et le compte des réponses. */
export const reviewSessions = pgTable(
  'review_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    certificationId: uuid('certification_id')
      .notNull()
      .references(() => certifications.id, { onDelete: 'cascade' }),
    /** Session limitée à un sous-thème (bouton « Flashcards » de « À revoir »), sinon toutes les cartes dues. */
    subtopicId: uuid('subtopic_id').references(() => subtopics.id),
    seed: integer('seed').notNull(),
    questionIds: jsonb('question_ids').$type<string[]>().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    answeredCount: integer('answered_count').notNull().default(0),
    correctCount: integer('correct_count').notNull().default(0),
  },
  (t) => [index('review_sessions_user_idx').on(t.userId, t.startedAt)],
);

export const reviewAnswers = pgTable(
  'review_answers',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => reviewSessions.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    response: jsonb('response').$type<Response>().notNull(),
    isCorrect: boolean('is_correct').notNull(),
    boxAfter: integer('box_after').notNull(),
    dueAfter: timestamp('due_after', { withTimezone: true }).notNull(),
    answeredAt: timestamp('answered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.questionId] })],
);

export type User = typeof users.$inferSelect;
export type LabAttempt = typeof labAttempts.$inferSelect;
export type ReviewSession = typeof reviewSessions.$inferSelect;
export type Attempt = typeof attempts.$inferSelect;
