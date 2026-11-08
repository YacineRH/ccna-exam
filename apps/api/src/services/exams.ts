import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { attempts, certifications, examQuestions, exams } from '../db/schema.js';
import { notFound } from '../errors.js';

export interface SeriesExamProgress {
  number: number;
  title: string;
  questionCount: number;
  /** Passages terminés (soumis ou arrivés à échéance) en mode examen. */
  taken: number;
  bestScore: number | null;
  /** Le meilleur passage atteint le seuil de réussite. */
  passed: boolean;
  lastAt: string | null;
  /** Passage en cours sur cet examen, à reprendre. */
  inProgress: string | null;
}

export interface SeriesProgress {
  certification: string;
  passingScore: number;
  total: number;
  /** Examens passés au moins une fois. */
  taken: number;
  /** Examens dont le meilleur score atteint le seuil. */
  passed: number;
  /** Plus petit numéro jamais commencé, ou null si tous l'ont été. */
  nextNumber: number | null;
  exams: SeriesExamProgress[];
}

/** Progression d'un utilisateur dans la série d'examens blancs figés d'une certification. */
export async function seriesProgress(db: Db, userId: string, code: string): Promise<SeriesProgress> {
  const [cert] = await db.select().from(certifications).where(eq(certifications.code, code));
  if (!cert || !cert.active) throw notFound(`Certification inconnue : ${code}`);
  const rows = await db
    .select({ id: exams.id, number: exams.number, title: exams.title, questionCount: count(examQuestions.questionId) })
    .from(exams)
    .leftJoin(examQuestions, eq(examQuestions.examId, exams.id))
    .where(eq(exams.certificationId, cert.id))
    .groupBy(exams.id, exams.number, exams.title)
    .orderBy(asc(exams.number));
  const mine = rows.length
    ? await db
        .select({ id: attempts.id, examId: attempts.examId, status: attempts.status, mode: attempts.mode, scaledScore: attempts.scaledScore, submittedAt: attempts.submittedAt })
        .from(attempts)
        .where(and(eq(attempts.userId, userId), inArray(attempts.examId, rows.map((r) => r.id))))
    : [];

  const passing = cert.config.scoring.passing;
  const list: SeriesExamProgress[] = rows.map((r) => {
    const own = mine.filter((a) => a.examId === r.id);
    const done = own.filter((a) => a.mode === 'exam' && a.status !== 'in_progress');
    const scores = done.map((a) => a.scaledScore).filter((s): s is number => s !== null);
    const best = scores.length ? Math.max(...scores) : null;
    const last = done.map((a) => a.submittedAt).filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime())[0];
    return {
      number: r.number,
      title: r.title,
      questionCount: Number(r.questionCount),
      taken: done.length,
      bestScore: best,
      passed: best !== null && best >= passing,
      lastAt: last?.toISOString() ?? null,
      inProgress: own.find((a) => a.status === 'in_progress')?.id ?? null,
    };
  });
  const started = new Set(mine.map((a) => a.examId));
  return {
    certification: cert.code,
    passingScore: passing,
    total: list.length,
    taken: list.filter((e) => e.taken > 0).length,
    passed: list.filter((e) => e.passed).length,
    nextNumber: rows.find((r) => !started.has(r.id))?.number ?? null,
    exams: list,
  };
}
