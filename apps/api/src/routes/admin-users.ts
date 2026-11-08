import { count, desc, eq, max, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { attempts, users } from '../db/schema.js';
import { conflict, forbidden, parseInput } from '../errors.js';
import { generatePassword, hashPassword, MIN_PASSWORD_LENGTH } from '../services/passwords.js';

/*
 * Comptes créés par l'administrateur (invités). Les inscriptions restent fermées : c'est le seul moyen
 * d'ajouter un utilisateur sans les rouvrir. Réservé à une **session** d'administrateur : le jeton de
 * service du serveur MCP, qui agit au nom de l'administrateur pour générer du contenu, n'a pas ce droit.
 */

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  displayName: z.string().trim().min(1, 'Nom affiché requis').max(64),
  /** Facultatif : sans mot de passe, un mot de passe aléatoire est généré et renvoyé une seule fois. */
  password: z.string().min(MIN_PASSWORD_LENGTH, `${MIN_PASSWORD_LENGTH} caractères minimum`).max(256).optional(),
});

async function requireAdminSession(app: FastifyInstance, req: FastifyRequest) {
  const user = await app.requireAdmin(req);
  if (user.service) throw forbidden("Réservé à une session d'administrateur (pas au jeton de service)");
  return user;
}

export function adminUserRoutes(db: Db) {
  return async (app: FastifyInstance) => {
    app.addHook('preHandler', async (req) => {
      await requireAdminSession(app, req);
    });

    /** Comptes, avec leur activité : de quoi voir si un invité s'est servi de son accès. */
    app.get('/', async () => {
      const rows = await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          role: users.role,
          createdAt: users.createdAt,
          attempts: count(attempts.id),
          lastActiveAt: max(attempts.startedAt),
        })
        .from(users)
        .leftJoin(attempts, eq(attempts.userId, users.id))
        .groupBy(users.id)
        .orderBy(desc(users.createdAt));
      return {
        users: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), lastActiveAt: r.lastActiveAt?.toISOString() ?? null })),
      };
    });

    app.post('/', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
      const admin = await requireAdminSession(app, req);
      const input = parseInput(createSchema, req.body);
      const [existing] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${input.email}`);
      if (existing) throw conflict('email_taken', 'Un compte existe déjà avec cet e-mail');

      const generated = input.password === undefined;
      const password = input.password ?? generatePassword();
      const [user] = await db
        .insert(users)
        // Toujours un compte « user » : un administrateur ne se crée pas par cette route.
        .values({ email: input.email, passwordHash: await hashPassword(password), displayName: input.displayName, role: 'user' })
        .returning({ id: users.id, email: users.email, displayName: users.displayName, role: users.role, createdAt: users.createdAt });
      req.log.info({ adminId: admin.id, userId: user!.id }, 'compte invité créé');
      // Le mot de passe n'est renvoyé que s'il a été généré, et une seule fois : il n'est stocké que haché.
      return reply.code(201).send({
        user: { ...user!, createdAt: user!.createdAt.toISOString() },
        ...(generated ? { password } : {}),
        generated,
      });
    });
  };
}
