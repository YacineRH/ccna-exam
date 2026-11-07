import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { asc, eq, sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from './db/client.js';
import { users } from './db/schema.js';
import type { Env } from './env.js';
import { HttpError } from './errors.js';
import authPlugin, { SESSION_COOKIE } from './plugins/auth.js';
import { adminRoutes } from './routes/admin.js';
import { attemptRoutes } from './routes/attempts.js';
import { authRoutes } from './routes/auth.js';
import { certificationRoutes } from './routes/certifications.js';
import { statsRoutes } from './routes/stats.js';

export async function buildApp(env: Env, db: Db): Promise<FastifyInstance> {
  const app = Fastify({
    logger: env.NODE_ENV === 'test' ? false : { level: env.LOG_LEVEL, redact: ['req.headers.cookie', 'req.headers.authorization'] },
    trustProxy: true,
    bodyLimit: 256 * 1024,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });
  await app.register(cookie);
  await app.register(jwt, { secret: env.JWT_SECRET, cookie: { cookieName: SESSION_COOKIE, signed: false } });
  await app.register(authPlugin, {
    sessionTtlHours: env.SESSION_TTL_HOURS,
    secureCookies: env.NODE_ENV === 'production' && env.COOKIE_SECURE,
    serviceToken: env.SERVICE_TOKEN,
    resolveServiceUser: async () => {
      const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin')).orderBy(asc(users.createdAt)).limit(1);
      return admin?.id ?? null;
    },
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.code(status).send({ error: { code: 'request_error', message: (err as Error).message } });
    }
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'internal', message: 'Erreur interne' } });
  });

  // L'API est versionnée dès le départ : tout vit sous /api/v1.
  await app.register(
    async (v1) => {
      v1.get('/health', async () => {
        await db.execute(sql`select 1`);
        return { status: 'ok' };
      });
      await v1.register(authRoutes(db, { allowRegistration: env.ALLOW_REGISTRATION }), { prefix: '/auth' });
      await v1.register(certificationRoutes(db), { prefix: '/certifications' });
      await v1.register(attemptRoutes(db), { prefix: '/attempts' });
      await v1.register(statsRoutes(db), { prefix: '/stats' });
      await v1.register(adminRoutes(db), { prefix: '/admin' });
    },
    { prefix: '/api/v1' },
  );

  return app;
}
