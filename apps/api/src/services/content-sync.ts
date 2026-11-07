import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { CertificationConfig, Question } from '@examforge/core';
import type { Db } from '../db/client.js';
import { certifications, domains, questions, subtopics } from '../db/schema.js';

/**
 * Empreinte d'une question : énoncé, exhibit et textes des choix, normalisés.
 * Deux questions qui ne diffèrent que par la casse, les espaces ou l'ordre des options ont la même.
 */
export function contentHash(q: Pick<Question, 'body'>): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const body = q.body;
  const parts: string[] = [body.type, norm(body.stem), norm(body.exhibit ?? '')];
  if (body.type === 'mcq_single' || body.type === 'mcq_multi') parts.push(...body.options.map((o) => norm(o.text)).sort());
  if (body.type === 'ordering') parts.push(...body.items.map((o) => norm(o.text)).sort());
  if (body.type === 'matching') parts.push(...[...body.left, ...body.right].map((o) => norm(o.text)).sort());
  if (body.type === 'fill_blank') parts.push(...body.fields.map((f) => norm(f.label)).sort());
  return createHash('sha256').update(parts.join('␟')).digest('hex');
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
