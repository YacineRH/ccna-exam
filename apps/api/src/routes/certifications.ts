import { and, count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import { certifications, domains, exams, questions } from '../db/schema.js';
import { notFound } from '../errors.js';

export function certificationRoutes(db: Db) {
  return async (app: FastifyInstance) => {
    app.get('/', async () => {
      const rows = await db
        .select({ code: certifications.code, name: certifications.name, vendor: certifications.vendor, examCode: certifications.examCode })
        .from(certifications)
        .where(eq(certifications.active, true))
        .orderBy(certifications.code);
      return { certifications: rows };
    });

    app.get<{ Params: { code: string } }>('/:code', async (req) => {
      const [cert] = await db.select().from(certifications).where(eq(certifications.code, req.params.code));
      if (!cert || !cert.active) throw notFound(`Certification inconnue : ${req.params.code}`);

      const perDomain = await db
        .select({ domain: domains.code, questions: count(questions.id) })
        .from(domains)
        .leftJoin(questions, and(eq(questions.domainId, domains.id), eq(questions.status, 'published')))
        .where(eq(domains.certificationId, cert.id))
        .groupBy(domains.code);
      const [{ total: examCount } = { total: 0 }] = await db
        .select({ total: count() })
        .from(exams)
        .where(eq(exams.certificationId, cert.id));

      return {
        certification: cert.config,
        bank: {
          questions: perDomain.reduce((s, d) => s + d.questions, 0),
          byDomain: Object.fromEntries(perDomain.map((d) => [d.domain, d.questions])),
          exams: examCount,
        },
      };
    });
  };
}
