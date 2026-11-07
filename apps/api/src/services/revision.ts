import { and, asc, count, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import {
  DECK_MAX,
  DECK_MIN,
  MASTERED_BOX,
  grade,
  newCard,
  pickDeck,
  reviewCard,
  toPublicBody,
  type QuestionType,
  type Response,
} from '@examforge/core';
import type { Db } from '../db/client.js';
import { certifications, domains, questions, reviewAnswers, reviewCards, reviewSessions, subtopics, type ReviewSession } from '../db/schema.js';
import { conflict, forbidden, notFound } from '../errors.js';

/*
 * Révision espacée (flashcards / QCM rapides). Un paquet = 10 à 20 questions publiées d'un sous-thème,
 * de types rapides. L'algorithme (Leitner) est dans packages/core ; ici, seulement la persistance.
 * Comme en entraînement, la correction d'une carte n'est envoyée qu'après la réponse à cette carte.
 */

/** Types de questions qui se prêtent à une réponse rapide. */
export const REVISION_TYPES: QuestionType[] = ['mcq_single', 'mcq_multi', 'fill_blank', 'cli'];
/** Cartes au plus par session. */
export const SESSION_MAX = 20;
/** Un sous-thème donne un paquet s'il a au moins ce nombre de questions rapides. */
const DECK_MIN_AVAILABLE = 3;

async function certificationByCode(db: Db, code: string) {
  const [cert] = await db.select().from(certifications).where(eq(certifications.code, code));
  if (!cert || !cert.active) throw notFound(`Certification inconnue : ${code}`);
  return cert;
}

/** Questions candidates d'un paquet, par sous-thème. */
async function deckQuestions(db: Db, certId: string, subtopicId?: string) {
  const rows = await db
    .select({ id: questions.id, subtopicId: questions.subtopicId })
    .from(questions)
    .where(
      and(
        eq(questions.certificationId, certId),
        eq(questions.status, 'published'),
        inArray(questions.type, REVISION_TYPES),
        subtopicId ? eq(questions.subtopicId, subtopicId) : sql`${questions.subtopicId} is not null`,
      ),
    );
  const bySubtopic = new Map<string, { id: string }[]>();
  for (const r of rows) {
    const list = bySubtopic.get(r.subtopicId as string) ?? [];
    list.push({ id: r.id });
    bySubtopic.set(r.subtopicId as string, list);
  }
  return new Map([...bySubtopic].map(([sub, qs]) => [sub, pickDeck(qs, DECK_MAX)]));
}

/** Vue d'ensemble : cartes dues, paquets par sous-thème (inscrits ou non), prochaine échéance. */
export async function revisionOverview(db: Db, userId: string, certCode: string, now = new Date()) {
  const cert = await certificationByCode(db, certCode);
  const subs = await db
    .select({ id: subtopics.id, code: subtopics.code, name: subtopics.name, domain: domains.code, position: domains.position })
    .from(subtopics)
    .innerJoin(domains, eq(domains.id, subtopics.domainId))
    .where(eq(domains.certificationId, cert.id))
    .orderBy(asc(domains.position), asc(subtopics.code));
  const decks = await deckQuestions(db, cert.id);
  const cards = await db
    .select({
      subtopicId: reviewCards.subtopicId,
      total: count(),
      due: sql<number>`count(*) filter (where ${reviewCards.dueAt} <= ${now.toISOString()})::int`,
      mastered: sql<number>`count(*) filter (where ${reviewCards.box} >= ${MASTERED_BOX})::int`,
      fresh: sql<number>`count(*) filter (where ${reviewCards.reviews} = 0)::int`,
      nextDue: sql<string | null>`min(${reviewCards.dueAt}) filter (where ${reviewCards.dueAt} > ${now.toISOString()})`,
    })
    .from(reviewCards)
    .where(and(eq(reviewCards.userId, userId), eq(reviewCards.certificationId, cert.id)))
    .groupBy(reviewCards.subtopicId);
  const bySub = new Map(cards.map((c) => [c.subtopicId, c]));
  const list = subs
    .map((s) => {
      const c = bySub.get(s.id);
      const available = decks.get(s.id)?.length ?? 0;
      return {
        subtopic: s.code,
        subtopicName: s.name,
        domain: s.domain,
        available,
        enrolled: c !== undefined,
        cards: c ? Number(c.total) : 0,
        due: c?.due ?? 0,
        fresh: c?.fresh ?? 0,
        mastered: c?.mastered ?? 0,
        nextDueAt: c?.nextDue ? new Date(c.nextDue).toISOString() : null,
      };
    })
    .filter((d) => d.available >= DECK_MIN_AVAILABLE || d.enrolled);
  const nextDue = list.map((d) => d.nextDueAt).filter((d): d is string => d !== null).sort()[0] ?? null;
  return {
    certification: cert.code,
    serverNow: now.toISOString(),
    dueToday: list.reduce((n, d) => n + d.due, 0),
    totalCards: list.reduce((n, d) => n + d.cards, 0),
    nextDueAt: nextDue,
    deckSize: { min: DECK_MIN, max: DECK_MAX },
    decks: list,
  };
}

async function subtopicByCode(db: Db, certId: string, code: string) {
  const [sub] = await db
    .select({ id: subtopics.id, code: subtopics.code, name: subtopics.name })
    .from(subtopics)
    .innerJoin(domains, eq(domains.id, subtopics.domainId))
    .where(and(eq(domains.certificationId, certId), eq(subtopics.code, code)));
  if (!sub) throw notFound(`Sous-thème inconnu : ${code}`);
  return sub;
}

/** Ajoute le paquet d'un sous-thème (cartes nouvelles, dues tout de suite). Sans effet s'il l'est déjà. */
export async function enrollDeck(db: Db, userId: string, certCode: string, subtopicCode: string, now = new Date()) {
  const cert = await certificationByCode(db, certCode);
  const sub = await subtopicByCode(db, cert.id, subtopicCode);
  const deck = (await deckQuestions(db, cert.id, sub.id)).get(sub.id) ?? [];
  if (deck.length < DECK_MIN_AVAILABLE) throw conflict('deck_too_small', `Pas assez de questions rapides pour le sous-thème ${subtopicCode}`);
  const card = newCard(now);
  const inserted = await db
    .insert(reviewCards)
    .values(deck.map((q) => ({ userId, questionId: q.id, certificationId: cert.id, subtopicId: sub.id, box: card.box, intervalDays: card.intervalDays, dueAt: card.dueAt })))
    .onConflictDoNothing()
    .returning({ id: reviewCards.questionId });
  return { subtopic: sub.code, added: inserted.length, cards: deck.length };
}

/** Démarre une session : les cartes dues (d'un sous-thème, ou toutes), les plus en retard d'abord. */
export async function startRevisionSession(
  db: Db,
  userId: string,
  input: { certification: string; subtopic?: string; limit?: number },
  now = new Date(),
) {
  const cert = await certificationByCode(db, input.certification);
  let subtopicId: string | null = null;
  if (input.subtopic) {
    subtopicId = (await subtopicByCode(db, cert.id, input.subtopic)).id;
    // Depuis « À revoir », le paquet est ajouté au besoin.
    await enrollDeck(db, userId, cert.code, input.subtopic, now);
  }
  const due = await db
    .select({ questionId: reviewCards.questionId })
    .from(reviewCards)
    .innerJoin(questions, eq(questions.id, reviewCards.questionId))
    .where(
      and(
        eq(reviewCards.userId, userId),
        eq(reviewCards.certificationId, cert.id),
        lte(reviewCards.dueAt, now),
        eq(questions.status, 'published'),
        subtopicId ? eq(reviewCards.subtopicId, subtopicId) : undefined,
      ),
    )
    .orderBy(asc(reviewCards.dueAt), asc(reviewCards.box))
    .limit(Math.min(input.limit ?? SESSION_MAX, SESSION_MAX));
  if (!due.length) throw conflict('nothing_due', 'Aucune carte à réviser pour le moment');
  const [session] = await db
    .insert(reviewSessions)
    .values({
      userId,
      certificationId: cert.id,
      subtopicId,
      seed: Math.floor(Math.random() * 2 ** 31),
      questionIds: due.map((d) => d.questionId),
      startedAt: now,
    })
    .returning();
  return getRevisionSession(db, (session as ReviewSession).id, userId);
}

async function ownedSession(db: Db, sessionId: string, userId: string) {
  const [s] = await db.select().from(reviewSessions).where(eq(reviewSessions.id, sessionId));
  if (!s) throw notFound('Session de révision introuvable');
  if (s.userId !== userId) throw forbidden();
  return s;
}

const cardSeed = (session: ReviewSession, i: number) => (session.seed + i * 7919) % 2 ** 31;

/** État d'une session : les cartes (énoncés publics), et pour celles déjà répondues, la correction. */
export async function getRevisionSession(db: Db, sessionId: string, userId: string) {
  const session = await ownedSession(db, sessionId, userId);
  const rows = await db
    .select({
      id: questions.id,
      type: questions.type,
      difficulty: questions.difficulty,
      body: questions.body,
      key: questions.answerKey,
      explanation: questions.explanation,
      notes: questions.distractorNotes,
      reference: questions.reference,
      subtopic: subtopics.code,
      subtopicName: subtopics.name,
    })
    .from(questions)
    .leftJoin(subtopics, eq(subtopics.id, questions.subtopicId))
    .where(inArray(questions.id, session.questionIds));
  const answers = await db.select().from(reviewAnswers).where(eq(reviewAnswers.sessionId, session.id));
  const answered = new Map(answers.map((a) => [a.questionId, a]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const cards = session.questionIds
    .map((id, i) => {
      const r = byId.get(id);
      if (!r) return null;
      const a = answered.get(id);
      return {
        questionId: r.id,
        position: i,
        type: r.type,
        difficulty: r.difficulty,
        subtopic: r.subtopic,
        subtopicName: r.subtopicName,
        body: toPublicBody(r.body, cardSeed(session, i)),
        answer: a
          ? {
              response: a.response,
              correct: a.isCorrect,
              boxAfter: a.boxAfter,
              dueAfter: a.dueAfter,
              // Correction seulement une fois la carte répondue.
              feedback: { key: r.key, explanation: r.explanation, distractorNotes: r.notes, reference: r.reference },
            }
          : null,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);
  return {
    id: session.id,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    answeredCount: session.answeredCount,
    correctCount: session.correctCount,
    total: cards.length,
    cards,
    serverNow: new Date().toISOString(),
  };
}

/** Répond à une carte : correction immédiate, puis nouvelle boîte et nouvelle échéance (Leitner). */
export async function answerRevisionCard(
  db: Db,
  sessionId: string,
  userId: string,
  input: { questionId: string; response: Response; tzOffsetMinutes?: number },
  now = new Date(),
) {
  const session = await ownedSession(db, sessionId, userId);
  if (!session.questionIds.includes(input.questionId)) throw notFound('Cette carte ne fait pas partie de la session');
  const [q] = await db
    .select({ key: questions.answerKey, explanation: questions.explanation, notes: questions.distractorNotes, reference: questions.reference })
    .from(questions)
    .where(eq(questions.id, input.questionId));
  if (!q) throw notFound('Question introuvable');
  if (input.response.type !== q.key.type) {
    throw conflict('response_type_mismatch', `Réponse de type ${input.response.type} pour une question ${q.key.type}`);
  }
  const result = grade(q.key, input.response);

  return db.transaction(async (tx) => {
    const [card] = await tx
      .select()
      .from(reviewCards)
      .where(and(eq(reviewCards.userId, userId), eq(reviewCards.questionId, input.questionId)))
      .for('update');
    if (!card) throw notFound('Carte introuvable');
    const [already] = await tx
      .select({ questionId: reviewAnswers.questionId })
      .from(reviewAnswers)
      .where(and(eq(reviewAnswers.sessionId, session.id), eq(reviewAnswers.questionId, input.questionId)));
    if (already) throw conflict('already_answered', 'Carte déjà répondue dans cette session');
    const next = reviewCard(
      { box: card.box, intervalDays: card.intervalDays, dueAt: card.dueAt, reviews: card.reviews, lapses: card.lapses, lastReviewedAt: card.lastReviewedAt },
      result.correct,
      now,
      input.tzOffsetMinutes ?? 0,
    );
    await tx
      .update(reviewCards)
      .set({ box: next.box, intervalDays: next.intervalDays, dueAt: next.dueAt, reviews: next.reviews, lapses: next.lapses, lastReviewedAt: now })
      .where(and(eq(reviewCards.userId, userId), eq(reviewCards.questionId, input.questionId)));
    await tx.insert(reviewAnswers).values({
      sessionId: session.id,
      questionId: input.questionId,
      response: input.response,
      isCorrect: result.correct,
      boxAfter: next.box,
      dueAfter: next.dueAt,
      answeredAt: now,
    });
    const answeredCount = session.answeredCount + 1;
    const [updated] = await tx
      .update(reviewSessions)
      .set({
        answeredCount: sql`${reviewSessions.answeredCount} + 1`,
        correctCount: sql`${reviewSessions.correctCount} + ${result.correct ? 1 : 0}`,
        ...(answeredCount >= session.questionIds.length ? { finishedAt: now } : {}),
      })
      .where(eq(reviewSessions.id, session.id))
      .returning();
    return {
      correct: result.correct,
      partial: result.partial,
      box: next.box,
      intervalDays: next.intervalDays,
      dueAt: next.dueAt.toISOString(),
      feedback: { key: q.key, explanation: q.explanation, distractorNotes: q.notes, reference: q.reference },
      answeredCount: updated?.answeredCount ?? answeredCount,
      correctCount: updated?.correctCount ?? session.correctCount,
      finished: updated?.finishedAt !== null && updated?.finishedAt !== undefined,
      serverNow: now.toISOString(),
    };
  });
}

/** Historique des sessions de révision. */
export async function listRevisionSessions(db: Db, userId: string, opts: { certification?: string; limit?: number } = {}) {
  const rows = await db
    .select({ s: reviewSessions, certification: certifications.code, subtopic: subtopics.code, subtopicName: subtopics.name })
    .from(reviewSessions)
    .innerJoin(certifications, eq(certifications.id, reviewSessions.certificationId))
    .leftJoin(subtopics, eq(subtopics.id, reviewSessions.subtopicId))
    .where(and(eq(reviewSessions.userId, userId), opts.certification ? eq(certifications.code, opts.certification) : undefined))
    .orderBy(desc(reviewSessions.startedAt))
    .limit(opts.limit ?? 50);
  return rows.map((r) => ({
    id: r.s.id,
    certification: r.certification,
    subtopic: r.subtopic,
    subtopicName: r.subtopicName,
    startedAt: r.s.startedAt,
    finishedAt: r.s.finishedAt,
    total: r.s.questionIds.length,
    answeredCount: r.s.answeredCount,
    correctCount: r.s.correctCount,
  }));
}
