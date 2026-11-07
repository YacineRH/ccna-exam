import { hash, verify } from '@node-rs/argon2';
import { count, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';
import { conflict, forbidden, parseInput, unauthorized } from '../errors.js';

// Paramètres argon2id recommandés par l'OWASP (19 Mio, 2 passes).
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
// Haché factice : on vérifie quand même un mot de passe quand l'e-mail n'existe pas,
// pour ne pas révéler par le temps de réponse quels comptes existent.
let dummyHash: Promise<string> | null = null;

const credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(12, '12 caractères minimum').max(256),
});
const registration = credentials.extend({ displayName: z.string().trim().min(1).max(64) });

export function authRoutes(db: Db, opts: { allowRegistration: boolean }) {
  return async (app: FastifyInstance) => {
    const loginLimit = { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } };

    app.post('/register', loginLimit, async (req, reply) => {
      const input = parseInput(registration, req.body);
      const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(users);
      const first = total === 0;
      if (!first && !opts.allowRegistration) throw forbidden('Les inscriptions sont fermées');

      const [existing] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${input.email}`);
      if (existing) throw conflict('email_taken', 'Un compte existe déjà avec cet e-mail');

      const [user] = await db
        .insert(users)
        .values({
          email: input.email,
          passwordHash: await hash(input.password, ARGON),
          displayName: input.displayName,
          role: first ? 'admin' : 'user',
        })
        .returning({ id: users.id, email: users.email, displayName: users.displayName, role: users.role });
      await app.setSession(reply, user!);
      return reply.code(201).send({ user });
    });

    app.post('/login', loginLimit, async (req, reply) => {
      const input = parseInput(credentials, req.body);
      const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${input.email}`);
      dummyHash ??= hash('mot-de-passe-factice-pour-le-timing', ARGON);
      const ok = await verify(user?.passwordHash ?? (await dummyHash), input.password);
      if (!user || !ok) throw unauthorized('E-mail ou mot de passe incorrect');
      await app.setSession(reply, user);
      return { user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role } };
    });

    app.post('/logout', async (_req, reply) => {
      app.clearSession(reply);
      return reply.code(204).send();
    });

    app.get('/me', async (req) => {
      const session = await app.requireUser(req);
      const [user] = await db
        .select({ id: users.id, email: users.email, displayName: users.displayName, role: users.role })
        .from(users)
        .where(eq(users.id, session.id));
      if (!user) throw unauthorized();
      return { user };
    });
  };
}
