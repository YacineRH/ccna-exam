import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { estimateReadiness } from '@examforge/core';
import type { Db } from '../db/client.js';
import { attemptAnswers, attempts, certifications, domains, questions, subtopics } from '../db/schema.js';
import { notFound } from '../errors.js';

/** Fenêtre d'analyse des erreurs récentes pour la liste « à revoir ». */
const REVIEW_WINDOW_DAYS = 30;

/** Tableau de bord d'un utilisateur pour une certification. */
export async function getStats(db: Db, userId: string, certCode: string) {
  const [cert] = await db.select().from(certifications).where(eq(certifications.code, certCode));
  if (!cert) throw notFound(`Certification inconnue : ${certCode}`);
  const config = cert.config;

  // Seuls les examens blancs comptent pour le niveau de préparation ; l'entraînement nourrit la maîtrise.
  const finishedExams = await db
    .select({ id: attempts.id, scaledScore: attempts.scaledScore, submittedAt: attempts.submittedAt })
    .from(attempts)
    .where(
      and(
        eq(attempts.userId, userId),
        eq(attempts.certificationId, cert.id),
        eq(attempts.mode, 'exam'),
        inArray(attempts.status, ['submitted', 'expired']),
        isNotNull(attempts.scaledScore),
      ),
    )
    .orderBy(asc(attempts.submittedAt));

  const recent = finishedExams.slice(-30).map((a) => ({
    attemptId: a.id,
    scaledScore: a.scaledScore as number,
    submittedAt: a.submittedAt,
  }));
  const readiness = estimateReadiness(
    finishedExams.map((a) => a.scaledScore as number),
    config,
  );

  // Maîtrise par domaine : toutes les réponses notées, examens et entraînement confondus.
  const perDomain = await db
    .select({
      code: domains.code,
      answered: sql<number>`count(*)::int`,
      correct: sql<number>`count(*) filter (where ${attemptAnswers.isCorrect})::int`,
      seconds: sql<number>`coalesce(sum(${attemptAnswers.secondsSpent}), 0)::int`,
    })
    .from(attemptAnswers)
    .innerJoin(attempts, eq(attempts.id, attemptAnswers.attemptId))
    .innerJoin(questions, eq(questions.id, attemptAnswers.questionId))
    .innerJoin(domains, eq(domains.id, questions.domainId))
    .where(
      and(eq(attempts.userId, userId), eq(attempts.certificationId, cert.id), isNotNull(attemptAnswers.isCorrect)),
    )
    .groupBy(domains.code);

  const byCode = new Map(perDomain.map((d) => [d.code, d]));
  const domainStats = config.domains.map((d) => {
    const s = byCode.get(d.code);
    const answered = s?.answered ?? 0;
    const correct = s?.correct ?? 0;
    return {
      code: d.code,
      name: d.name,
      weight: d.weight,
      answered,
      correct,
      percent: answered ? Math.round((correct / answered) * 1000) / 10 : null,
    };
  });

  // À revoir : sous-thèmes les plus échoués récemment, puis ceux au plus faible taux de réussite.
  const since = new Date(Date.now() - REVIEW_WINDOW_DAYS * 86_400_000);
  const weak = await db
    .select({
      domain: domains.code,
      subtopic: subtopics.code,
      subtopicName: subtopics.name,
      answered: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where not ${attemptAnswers.isCorrect})::int`,
    })
    .from(attemptAnswers)
    .innerJoin(attempts, eq(attempts.id, attemptAnswers.attemptId))
    .innerJoin(questions, eq(questions.id, attemptAnswers.questionId))
    .innerJoin(domains, eq(domains.id, questions.domainId))
    .leftJoin(subtopics, eq(subtopics.id, questions.subtopicId))
    .where(
      and(
        eq(attempts.userId, userId),
        eq(attempts.certificationId, cert.id),
        isNotNull(attemptAnswers.isCorrect),
        gte(attempts.startedAt, since),
      ),
    )
    .groupBy(domains.code, subtopics.code, subtopics.name)
    .having(sql`count(*) filter (where not ${attemptAnswers.isCorrect}) > 0`)
    .orderBy(desc(sql`count(*) filter (where not ${attemptAnswers.isCorrect})`), desc(sql`count(*)`))
    .limit(6);

  const answered = domainStats.reduce((s, d) => s + d.answered, 0);
  return {
    certification: cert.code,
    passingScore: config.scoring.passing,
    scale: { min: config.scoring.min, max: config.scoring.max },
    readiness,
    exams: { taken: finishedExams.length, lastAt: finishedExams.at(-1)?.submittedAt ?? null },
    recentScores: recent,
    questions: { answered, correct: domainStats.reduce((s, d) => s + d.correct, 0) },
    totalSeconds: perDomain.reduce((s, d) => s + d.seconds, 0),
    domains: domainStats,
    toReview: weak.map((w) => ({
      domain: w.domain,
      subtopic: w.subtopic,
      subtopicName: w.subtopicName,
      errors: w.errors,
      answered: w.answered,
    })),
  };
}
