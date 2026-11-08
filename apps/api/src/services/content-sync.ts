import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { contentKey, type CertificationConfig, type ExamSeries, type Lab, type Question } from '@examforge/core';
import type { Db } from '../db/client.js';
import { attempts, certifications, domains, examQuestions, exams, labs, questions, subtopics } from '../db/schema.js';

/**
 * Empreinte d'une question : SHA-256 de sa clé d'unicité (`contentKey` : énoncé, exhibit et textes
 * des choix, normalisés). Deux questions qui ne diffèrent que par la casse, les espaces ou l'ordre
 * des options ont la même.
 */
export function contentHash(q: Pick<Question, 'body'>): string {
  return createHash('sha256').update(contentKey(q.body)).digest('hex');
}

/** Crée ou met à jour une certification et ses domaines à partir de sa configuration. */
export async function upsertCertification(db: Db, cert: CertificationConfig): Promise<string> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(certifications)
      .values({ code: cert.code, name: cert.name, vendor: cert.vendor, examCode: cert.examCode, config: cert })
      .onConflictDoUpdate({
        target: certifications.code,
        set: { name: cert.name, vendor: cert.vendor, examCode: cert.examCode, config: cert, updatedAt: new Date() },
      })
      .returning({ id: certifications.id });
    const certId = (row as { id: string }).id;

    for (const [position, d] of cert.domains.entries()) {
      const [dom] = await tx
        .insert(domains)
        .values({ certificationId: certId, code: d.code, name: d.name, weight: d.weight, position })
        .onConflictDoUpdate({
          target: [domains.certificationId, domains.code],
          set: { name: d.name, weight: d.weight, position },
        })
        .returning({ id: domains.id });
      const domId = (dom as { id: string }).id;
      for (const s of d.subtopics) {
        await tx
          .insert(subtopics)
          .values({ domainId: domId, code: s.code, name: s.name })
          .onConflictDoUpdate({ target: [subtopics.domainId, subtopics.code], set: { name: s.name } });
      }
    }
    return certId;
  });
}

export class DuplicateQuestionError extends Error {
  constructor(public readonly slug: string, public readonly existingSlug: string) {
    super(`La question ${slug} reprend l'énoncé de ${existingSlug}`);
    this.name = 'DuplicateQuestionError';
  }
}

export interface UpsertQuestionOptions {
  status?: 'draft' | 'validated' | 'published';
  source?: 'manual' | 'import' | 'ai';
}

/**
 * Enregistre une question déjà validée par le moteur. Refuse un doublon d'énoncé
 * (même empreinte sous un autre slug) : c'est ce qui garantit une banque sans répétition.
 */
export async function upsertQuestion(
  db: Db,
  certId: string,
  q: Question,
  options: UpsertQuestionOptions = {},
): Promise<{ id: string; created: boolean }> {
  const hash = contentHash(q);
  const [twin] = await db
    .select({ slug: questions.slug })
    .from(questions)
    .where(and(eq(questions.certificationId, certId), eq(questions.contentHash, hash)));
  if (twin && twin.slug !== q.slug) throw new DuplicateQuestionError(q.slug, twin.slug);

  const [dom] = await db
    .select({ id: domains.id })
    .from(domains)
    .where(and(eq(domains.certificationId, certId), eq(domains.code, q.domain)));
  if (!dom) throw new Error(`Domaine ${q.domain} inconnu`);

  let subtopicId: string | null = null;
  if (q.subtopic) {
    const [sub] = await db
      .select({ id: subtopics.id })
      .from(subtopics)
      .where(and(eq(subtopics.domainId, dom.id), eq(subtopics.code, q.subtopic)));
    if (!sub) throw new Error(`Sous-thème ${q.subtopic} inconnu`);
    subtopicId = sub.id;
  }

  const values = {
    certificationId: certId,
    slug: q.slug,
    domainId: dom.id,
    subtopicId,
    type: q.body.type,
    difficulty: q.difficulty,
    body: q.body,
    answerKey: q.key,
    explanation: q.explanation,
    distractorNotes: q.distractorNotes,
    reference: q.reference ?? null,
    contentHash: hash,
    status: options.status ?? 'published',
    source: options.source ?? 'manual',
  };
  const [existing] = await db.select({ id: questions.id }).from(questions).where(eq(questions.slug, q.slug));
  if (existing) {
    await db
      .update(questions)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(questions.id, existing.id));
    return { id: existing.id, created: false };
  }
  const [row] = await db.insert(questions).values(values).returning({ id: questions.id });
  return { id: (row as { id: string }).id, created: true };
}

export class DuplicateLabError extends Error {
  constructor(public readonly slug: string, public readonly existingSlug: string) {
    super(`Le lab ${slug} reprend le titre de ${existingSlug}`);
    this.name = 'DuplicateLabError';
  }
}

/** Enregistre un lab déjà validé par le moteur (schéma, rangement, solution jouée). */
export async function upsertLab(
  db: Db,
  certId: string,
  lab: Lab,
  options: UpsertQuestionOptions = {},
): Promise<{ id: string; created: boolean }> {
  const [dom] = await db
    .select({ id: domains.id })
    .from(domains)
    .where(and(eq(domains.certificationId, certId), eq(domains.code, lab.domain)));
  if (!dom) throw new Error(`Domaine ${lab.domain} inconnu`);
  const [sub] = await db
    .select({ id: subtopics.id })
    .from(subtopics)
    .where(and(eq(subtopics.domainId, dom.id), eq(subtopics.code, lab.subtopic)));
  if (!sub) throw new Error(`Sous-thème ${lab.subtopic} inconnu`);

  const [twin] = await db
    .select({ slug: labs.slug })
    .from(labs)
    .where(and(eq(labs.certificationId, certId), eq(labs.title, lab.title)));
  if (twin && twin.slug !== lab.slug) throw new DuplicateLabError(lab.slug, twin.slug);

  const values = {
    certificationId: certId,
    slug: lab.slug,
    kind: lab.kind,
    domainId: dom.id,
    subtopicId: sub.id,
    difficulty: lab.difficulty,
    title: lab.title,
    definition: lab,
    status: options.status ?? 'published',
    source: options.source ?? 'manual',
  };
  const [existing] = await db.select({ id: labs.id }).from(labs).where(eq(labs.slug, lab.slug));
  if (existing) {
    await db.update(labs).set({ ...values, updatedAt: new Date() }).where(eq(labs.id, existing.id));
    return { id: existing.id, created: false };
  }
  const [row] = await db.insert(labs).values(values).returning({ id: labs.id });
  return { id: (row as { id: string }).id, created: true };
}

/** Sérialisation à clés triées : jsonb ne garde pas l'ordre des clés, la comparaison ne doit pas en dépendre. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export interface SyncQuestionsResult {
  created: number;
  updated: number;
  unchanged: number;
}

/**
 * Importe toute la banque d'une certification d'un bloc, avec les règles d'`upsertQuestion` (doublon
 * d'empreinte refusé, domaine et sous-thème existants) : l'existant est lu en une requête, les nouvelles
 * questions sont insérées par paquets et seules les questions modifiées sont réécrites. Un second import
 * du même contenu n'écrit rien.
 */
export async function syncQuestions(
  db: Db,
  certId: string,
  list: readonly Question[],
  options: Omit<UpsertQuestionOptions, 'source'> = {},
): Promise<SyncQuestionsResult> {
  const domRows = await db.select({ id: domains.id, code: domains.code }).from(domains).where(eq(domains.certificationId, certId));
  const domainId = new Map(domRows.map((d) => [d.code, d.id]));
  const subRows = domRows.length
    ? await db
        .select({ id: subtopics.id, code: subtopics.code, domainId: subtopics.domainId })
        .from(subtopics)
        .where(inArray(subtopics.domainId, domRows.map((d) => d.id)))
    : [];
  const subtopicId = new Map(subRows.map((s) => [`${s.domainId}|${s.code}`, s.id]));
  const existing = await db.select().from(questions).where(eq(questions.certificationId, certId));
  const bySlug = new Map(existing.map((r) => [r.slug, r]));
  const byHash = new Map(existing.map((r) => [r.contentHash, r.slug]));

  const fields = ['domainId', 'subtopicId', 'type', 'difficulty', 'body', 'answerKey', 'explanation', 'distractorNotes', 'reference', 'contentHash', 'status', 'source'] as const;
  const toInsert: (typeof questions.$inferInsert)[] = [];
  const toUpdate: { id: string; values: typeof questions.$inferInsert }[] = [];
  let unchanged = 0;
  for (const q of list) {
    const dom = domainId.get(q.domain);
    if (!dom) throw new Error(`Domaine ${q.domain} inconnu`);
    let sub: string | null = null;
    if (q.subtopic) {
      sub = subtopicId.get(`${dom}|${q.subtopic}`) ?? null;
      if (!sub) throw new Error(`Sous-thème ${q.subtopic} inconnu`);
    }
    const hash = contentHash(q);
    const twin = byHash.get(hash);
    if (twin && twin !== q.slug) throw new DuplicateQuestionError(q.slug, twin);
    byHash.set(hash, q.slug);
    const values = {
      certificationId: certId,
      slug: q.slug,
      domainId: dom,
      subtopicId: sub,
      type: q.body.type,
      difficulty: q.difficulty,
      body: q.body,
      answerKey: q.key,
      explanation: q.explanation,
      distractorNotes: q.distractorNotes,
      reference: q.reference ?? null,
      contentHash: hash,
      status: options.status ?? ('published' as const),
      source: q.source ?? ('import' as const),
    };
    const row = bySlug.get(q.slug);
    if (!row) toInsert.push(values);
    else if (fields.some((f) => stable(row[f]) !== stable(values[f]))) toUpdate.push({ id: row.id, values });
    else unchanged++;
  }
  for (let i = 0; i < toInsert.length; i += 200) await db.insert(questions).values(toInsert.slice(i, i + 200));
  for (const u of toUpdate) await db.update(questions).set({ ...u.values, updatedAt: new Date() }).where(eq(questions.id, u.id));
  return { created: toInsert.length, updated: toUpdate.length, unchanged };
}

export interface SyncSeriesResult {
  created: number;
  updated: number;
  unchanged: number;
  /** Examens dont le fichier diffère mais qui ont déjà été passés : ils restent tels quels. */
  frozen: number[];
}

/**
 * Importe la série d'examens figés d'une certification. Idempotent : un second import du même fichier
 * ne crée ni doublon ni nouvel examen. Un examen absent est créé ; un examen identique (mêmes questions,
 * même ordre) est laissé tel quel ; un examen qui diffère du fichier est réécrit **seulement si personne ne
 * l'a jamais commencé**. Un examen déjà passé ne change jamais de contenu : il est gardé et signalé (`frozen`).
 */
export async function syncExamSeries(db: Db, certId: string, series: ExamSeries): Promise<SyncSeriesResult> {
  const qRows = await db.select({ id: questions.id, slug: questions.slug }).from(questions).where(eq(questions.certificationId, certId));
  const idOf = new Map(qRows.map((r) => [r.slug, r.id]));
  const examRows = await db.select().from(exams).where(eq(exams.certificationId, certId));
  const byNumber = new Map(examRows.map((e) => [e.number, e]));
  const current = new Map<string, string[]>();
  if (examRows.length) {
    const rows = await db
      .select({ examId: examQuestions.examId, questionId: examQuestions.questionId })
      .from(examQuestions)
      .where(inArray(examQuestions.examId, examRows.map((e) => e.id)))
      .orderBy(asc(examQuestions.examId), asc(examQuestions.position));
    for (const r of rows) current.set(r.examId, [...(current.get(r.examId) ?? []), r.questionId]);
  }
  const taken = new Set(
    (
      await db
        .selectDistinct({ examId: attempts.examId })
        .from(attempts)
        .where(and(eq(attempts.certificationId, certId), isNotNull(attempts.examId)))
    ).map((r) => r.examId as string),
  );

  const result: SyncSeriesResult = { created: 0, updated: 0, unchanged: 0, frozen: [] };
  for (const exam of series.exams) {
    const ids = exam.questions.map((slug) => {
      const id = idOf.get(slug);
      if (!id) throw new Error(`Examen n°${exam.number} : question inconnue ${slug}`);
      return id;
    });
    const row = byNumber.get(exam.number);
    const rows = (examId: string) => ids.map((questionId, position) => ({ examId, questionId, position }));
    if (!row) {
      await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(exams)
          .values({ certificationId: certId, number: exam.number, title: exam.title, seed: series.seed, source: 'import' })
          .returning({ id: exams.id });
        await tx.insert(examQuestions).values(rows(created!.id));
      });
      result.created++;
      continue;
    }
    const before = current.get(row.id) ?? [];
    if (before.length === ids.length && before.every((id, i) => id === ids[i])) {
      if (row.title !== exam.title) await db.update(exams).set({ title: exam.title, updatedAt: new Date() }).where(eq(exams.id, row.id));
      result.unchanged++;
      continue;
    }
    if (taken.has(row.id)) {
      result.frozen.push(exam.number);
      continue;
    }
    await db.transaction(async (tx) => {
      await tx.delete(examQuestions).where(eq(examQuestions.examId, row.id));
      await tx.insert(examQuestions).values(rows(row.id));
      await tx.update(exams).set({ title: exam.title, seed: series.seed, source: 'import', updatedAt: new Date() }).where(eq(exams.id, row.id));
    });
    result.updated++;
  }
  return result;
}
