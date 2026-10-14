import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  assembleExam,
  createRng,
  grade,
  InsufficientQuestionsError,
  scoreExam,
  toPublicBody,
  type Response,
} from '@examforge/core';
import type { Db } from '../db/client.js';
import {
  attemptAnswers,
  attempts,
  certifications,
  domains,
  examQuestions,
  exams,
  questions,
  type Attempt,
} from '../db/schema.js';
import { conflict, forbidden, notFound } from '../errors.js';

/** Délai de tolérance réseau après la fin du chrono. */
const GRACE_MS = 30_000;
/** En dessous de ce temps moyen par question, un examen complet est jugé suspect. */
const SUSPICIOUS_AVG_SECONDS = 5;

export interface StartAttemptInput {
  certification: string;
  mode: 'exam' | 'practice';
  /** Examen blanc figé (1 à ~100). Sinon, un tirage pondéré dans la banque. */
  examNumber?: number;
  questionCount?: number;
  domains?: string[];
}

async function loadCertification(db: Db, code: string) {
  const [cert] = await db.select().from(certifications).where(eq(certifications.code, code));
  if (!cert || !cert.active) throw notFound(`Certification inconnue : ${code}`);
  return cert;
}

async function ownedAttempt(db: Db, attemptId: string, userId: string): Promise<Attempt> {
  const [attempt] = await db.select().from(attempts).where(eq(attempts.id, attemptId));
  if (!attempt) throw notFound('Tentative introuvable');
  if (attempt.userId !== userId) throw forbidden();
  return attempt;
}

/** Seed d'affichage propre à chaque question d'une tentative. */
const displaySeed = (attempt: Attempt, position: number) => (attempt.seed ^ (position * 2654435761)) >>> 0;

export async function startAttempt(db: Db, userId: string, input: StartAttemptInput) {
  const cert = await loadCertification(db, input.certification);
  const config = cert.config;
  const seed = Math.floor(createRng(Date.now() ^ Math.floor(Math.random() * 2 ** 31))() * 2 ** 31);

  let questionIds: string[];
  let examId: string | null = null;

  if (input.examNumber !== undefined) {
    const [exam] = await db
      .select()
      .from(exams)
      .where(and(eq(exams.certificationId, cert.id), eq(exams.number, input.examNumber)));
    if (!exam) throw notFound(`Examen blanc n°${input.examNumber} introuvable`);
    examId = exam.id;
    const rows = await db
      .select({ id: examQuestions.questionId })
      .from(examQuestions)
      .where(eq(examQuestions.examId, exam.id))
      .orderBy(asc(examQuestions.position));
    questionIds = rows.map((r) => r.id);
  } else {
    const pool = await db
      .select({ id: questions.id, domain: domains.code, type: questions.type, difficulty: questions.difficulty })
      .from(questions)
      .innerJoin(domains, eq(domains.id, questions.domainId))
      .where(and(eq(questions.certificationId, cert.id), eq(questions.status, 'published')));
    const seen = await db
      .selectDistinct({ id: attemptAnswers.questionId })
      .from(attemptAnswers)
      .innerJoin(attempts, eq(attempts.id, attemptAnswers.attemptId))
      .where(eq(attempts.userId, userId));

    const count = input.questionCount ?? (input.mode === 'exam' ? config.examFormat.questionCount : 10);
    try {
      questionIds = assembleExam(pool as Parameters<typeof assembleExam>[0], config, {
        seed,
        questionCount: count,
        ...(input.domains?.length ? { domains: input.domains } : {}),
        avoidIds: seen.map((s) => s.id),
      });
    } catch (err) {
      if (err instanceof InsufficientQuestionsError) {
        throw conflict('insufficient_questions', err.message, {
          domain: err.domain,
          needed: err.needed,
          available: err.available,
          poolSize: pool.length,
        });
      }
      throw err;
    }
  }

  const isExam = input.mode === 'exam';
  // La durée suit la proportion de questions par rapport au format officiel.
  const minutes = Math.max(1, Math.round((config.examFormat.durationMinutes * questionIds.length) / config.examFormat.questionCount));
  const now = new Date();

  return db.transaction(async (tx) => {
    const [attempt] = await tx
      .insert(attempts)
      .values({
        userId,
        certificationId: cert.id,
        examId,
        mode: input.mode,
        seed,
        allowBackNavigation: isExam ? config.examFormat.allowBackNavigation : true,
        startedAt: now,
        deadlineAt: isExam ? new Date(now.getTime() + minutes * 60_000) : null,
        totalCount: questionIds.length,
      })
      .returning();
    const created = attempt as Attempt;
    await tx.insert(attemptAnswers).values(
      questionIds.map((questionId, position) => ({ attemptId: created.id, questionId, position })),
    );
    return created;
  });
}

function isExpired(attempt: Attempt, now = Date.now()) {
  return attempt.deadlineAt !== null && now > attempt.deadlineAt.getTime() + GRACE_MS;
}

/** État d'une tentative tel que le navigateur peut le voir : jamais de correction en mode examen. */
export async function getAttemptState(db: Db, attemptId: string, userId: string) {
  let attempt = await ownedAttempt(db, attemptId, userId);
  if (attempt.status === 'in_progress' && isExpired(attempt)) {
    await submitAttempt(db, attemptId, userId, { expired: true });
    attempt = await ownedAttempt(db, attemptId, userId);
  }

  const rows = await db
    .select({
      questionId: attemptAnswers.questionId,
      position: attemptAnswers.position,
      response: attemptAnswers.response,
      flagged: attemptAnswers.flagged,
      isCorrect: attemptAnswers.isCorrect,
      body: questions.body,
      domain: domains.code,
      explanation: questions.explanation,
    })
    .from(attemptAnswers)
    .innerJoin(questions, eq(questions.id, attemptAnswers.questionId))
    .innerJoin(domains, eq(domains.id, questions.domainId))
    .where(eq(attemptAnswers.attemptId, attemptId))
    .orderBy(asc(attemptAnswers.position));

  const reveal = attempt.status !== 'in_progress' || attempt.mode === 'practice';
  return {
    id: attempt.id,
    mode: attempt.mode,
    status: attempt.status,
    startedAt: attempt.startedAt,
    deadlineAt: attempt.deadlineAt,
    allowBackNavigation: attempt.allowBackNavigation,
    furthestPosition: attempt.furthestPosition,
    totalCount: attempt.totalCount,
    questions: rows.map((r) => ({
      id: r.questionId,
      position: r.position,
      domain: r.domain,
      body: toPublicBody(r.body, displaySeed(attempt, r.position)),
      response: r.response,
      flagged: r.flagged,
      // En entraînement, la correction est immédiate ; en examen, seulement après la fin.
      ...(reveal && r.isCorrect !== null ? { isCorrect: r.isCorrect, explanation: r.explanation } : {}),
    })),
  };
}

export interface AnswerInput {
  response?: Response | null;
  flagged?: boolean;
  secondsSpent?: number;
}

export async function answerQuestion(db: Db, attemptId: string, userId: string, questionId: string, input: AnswerInput) {
  const attempt = await ownedAttempt(db, attemptId, userId);
  if (attempt.status !== 'in_progress') throw conflict('attempt_closed', 'Cette tentative est terminée');
  if (isExpired(attempt)) {
    await submitAttempt(db, attemptId, userId, { expired: true });
    throw conflict('attempt_expired', 'Le temps est écoulé : la tentative a été soumise');
  }

  const [row] = await db
    .select({ position: attemptAnswers.position, key: questions.answerKey, explanation: questions.explanation, notes: questions.distractorNotes })
    .from(attemptAnswers)
    .innerJoin(questions, eq(questions.id, attemptAnswers.questionId))
    .where(and(eq(attemptAnswers.attemptId, attemptId), eq(attemptAnswers.questionId, questionId)));
  if (!row) throw notFound("Cette question ne fait pas partie de la tentative");

  if (!attempt.allowBackNavigation && row.position < attempt.furthestPosition) {
    throw conflict('back_navigation_forbidden', 'Retour arrière interdit dans ce mode');
  }
  if (input.response && input.response.type !== row.key.type) {
    throw conflict('response_type_mismatch', `Réponse de type ${input.response.type} pour une question ${row.key.type}`);
  }

  const result = input.response ? grade(row.key, input.response) : null;
  await db.transaction(async (tx) => {
    await tx
      .update(attemptAnswers)
      .set({
        ...(input.response !== undefined ? { response: input.response, answeredAt: new Date() } : {}),
        ...(input.flagged !== undefined ? { flagged: input.flagged } : {}),
        // Le navigateur envoie un cumul qui repart de zéro après un rechargement : on garde le plus grand.
        ...(input.secondsSpent !== undefined
          ? { secondsSpent: sql`greatest(${attemptAnswers.secondsSpent}, ${Math.min(input.secondsSpent, 24 * 3600)})` }
          : {}),
        ...(result ? { isCorrect: result.correct, partial: result.partial } : {}),
      })
      .where(and(eq(attemptAnswers.attemptId, attemptId), eq(attemptAnswers.questionId, questionId)));
    if (row.position > attempt.furthestPosition) {
      await tx.update(attempts).set({ furthestPosition: row.position }).where(eq(attempts.id, attemptId));
    }
  });

  if (attempt.mode === 'practice' && result) {
    return { saved: true, feedback: { ...result, key: row.key, explanation: row.explanation, distractorNotes: row.notes } };
  }
  return { saved: true };
}

export async function submitAttempt(db: Db, attemptId: string, userId: string, opts: { expired?: boolean } = {}) {
  const attempt = await ownedAttempt(db, attemptId, userId);
  if (attempt.status !== 'in_progress') return getAttemptResult(db, attemptId, userId);

  const [cert] = await db.select().from(certifications).where(eq(certifications.id, attempt.certificationId));
  const rows = await db
    .select({
      questionId: attemptAnswers.questionId,
      response: attemptAnswers.response,
      secondsSpent: attemptAnswers.secondsSpent,
      key: questions.answerKey,
      domain: domains.code,
    })
    .from(attemptAnswers)
    .innerJoin(questions, eq(questions.id, attemptAnswers.questionId))
    .innerJoin(domains, eq(domains.id, questions.domainId))
    .where(eq(attemptAnswers.attemptId, attemptId));

  const graded = rows.map((r) => ({ ...r, result: grade(r.key, r.response) }));
  const score = scoreExam(
    graded.map((g) => ({ domain: g.domain, correct: g.result.correct, seconds: g.secondsSpent })),
    cert!.config,
  );

  await db.transaction(async (tx) => {
    for (const g of graded) {
      await tx
        .update(attemptAnswers)
        .set({ isCorrect: g.result.correct, partial: g.result.partial })
        .where(and(eq(attemptAnswers.attemptId, attemptId), eq(attemptAnswers.questionId, g.questionId)));
    }
    await tx
      .update(attempts)
      .set({
        status: opts.expired ? 'expired' : 'submitted',
        submittedAt: new Date(),
        correctCount: score.correct,
        scaledScore: score.scaled,
        passed: score.passed,
        domainScores: score.byDomain,
      })
      .where(eq(attempts.id, attemptId));
  });

  return getAttemptResult(db, attemptId, userId);
}

/** Résultat et post-mortem complet : disponible uniquement une fois la tentative close. */
export async function getAttemptResult(db: Db, attemptId: string, userId: string) {
  const attempt = await ownedAttempt(db, attemptId, userId);
  if (attempt.status === 'in_progress') throw conflict('attempt_open', "La tentative n'est pas encore soumise");
  const [cert] = await db.select().from(certifications).where(eq(certifications.id, attempt.certificationId));

  const rows = await db
    .select({
      questionId: attemptAnswers.questionId,
      position: attemptAnswers.position,
      response: attemptAnswers.response,
      flagged: attemptAnswers.flagged,
      secondsSpent: attemptAnswers.secondsSpent,
      isCorrect: attemptAnswers.isCorrect,
      slug: questions.slug,
      body: questions.body,
      key: questions.answerKey,
      explanation: questions.explanation,
      distractorNotes: questions.distractorNotes,
      reference: questions.reference,
      domain: domains.code,
    })
    .from(attemptAnswers)
    .innerJoin(questions, eq(questions.id, attemptAnswers.questionId))
    .innerJoin(domains, eq(domains.id, questions.domainId))
    .where(eq(attemptAnswers.attemptId, attemptId))
    .orderBy(asc(attemptAnswers.position));

  const answered = rows.filter((r) => r.response !== null);
  const totalSeconds = rows.reduce((s, r) => s + r.secondsSpent, 0);
  const suspicious =
    attempt.mode === 'exam' &&
    answered.length === rows.length &&
    rows.length >= 20 &&
    totalSeconds / rows.length < SUSPICIOUS_AVG_SECONDS;

  return {
    id: attempt.id,
    certification: cert!.code,
    mode: attempt.mode,
    status: attempt.status,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    correctCount: attempt.correctCount,
    totalCount: attempt.totalCount,
    scaledScore: attempt.scaledScore,
    passingScore: cert!.config.scoring.passing,
    passed: attempt.passed,
    domainScores: attempt.domainScores,
    totalSeconds,
    suspicious,
    review: rows.map((r) => ({
      questionId: r.questionId,
      position: r.position,
      slug: r.slug,
      domain: r.domain,
      body: r.body,
      key: r.key,
      response: r.response,
      isCorrect: r.isCorrect,
      flagged: r.flagged,
      secondsSpent: r.secondsSpent,
      explanation: r.explanation,
      distractorNotes: r.distractorNotes,
      reference: r.reference,
    })),
  };
}

export async function listAttempts(db: Db, userId: string, limit = 50) {
  return db
    .select({
      id: attempts.id,
      certification: certifications.code,
      mode: attempts.mode,
      status: attempts.status,
      startedAt: attempts.startedAt,
      submittedAt: attempts.submittedAt,
      scaledScore: attempts.scaledScore,
      passed: attempts.passed,
      correctCount: attempts.correctCount,
      totalCount: attempts.totalCount,
    })
    .from(attempts)
    .innerJoin(certifications, eq(certifications.id, attempts.certificationId))
    .where(eq(attempts.userId, userId))
    .orderBy(desc(attempts.startedAt))
    .limit(limit);
}

