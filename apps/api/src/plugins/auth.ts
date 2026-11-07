import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { forbidden, unauthorized } from '../errors.js';

export const SESSION_COOKIE = 'ef_session';

export interface SessionUser {
  id: string;
  role: 'user' | 'admin';
  /** Vrai pour le serveur MCP, authentifié par jeton de service. */
  service?: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    requireUser: (req: FastifyRequest) => Promise<SessionUser>;
    requireAdmin: (req: FastifyRequest) => Promise<SessionUser>;
    setSession: (reply: FastifyReply, user: { id: string; role: 'user' | 'admin' }) => Promise<void>;
    clearSession: (reply: FastifyReply) => void;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: 'user' | 'admin' };
    user: { sub: string; role: 'user' | 'admin' };
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export interface AuthOptions {
  sessionTtlHours: number;
  secureCookies: boolean;
  serviceToken?: string | undefined;
  /** Compte au nom duquel agit le jeton de service (l'administrateur). */
  resolveServiceUser: () => Promise<string | null>;
}

/**
 * Sessions par JWT dans un cookie httpOnly, SameSite=Strict (pas de jeton lisible en JavaScript).
 * Le serveur MCP s'authentifie, lui, par un jeton de service dans l'en-tête Authorization.
 */
export default fp<AuthOptions>(async (app: FastifyInstance, opts) => {
  const maxAge = opts.sessionTtlHours * 3600;

  app.decorate('setSession', async (reply: FastifyReply, user: { id: string; role: 'user' | 'admin' }) => {
    const token = await reply.jwtSign({ sub: user.id, role: user.role }, { expiresIn: `${opts.sessionTtlHours}h` });
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: opts.secureCookies,
      sameSite: 'strict',
      path: '/',
      maxAge,
    });
  });

  app.decorate('clearSession', (reply: FastifyReply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
  });

  app.decorate('requireUser', async (req: FastifyRequest): Promise<SessionUser> => {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ') && opts.serviceToken) {
      if (!safeEqual(header.slice(7), opts.serviceToken)) throw unauthorized('Jeton de service invalide');
      const id = await opts.resolveServiceUser();
      if (!id) throw unauthorized('Aucun administrateur pour le jeton de service');
      return { id, role: 'admin', service: true };
    }
    try {
      const payload = await req.jwtVerify<{ sub: string; role: 'user' | 'admin' }>({ onlyCookie: true });
      return { id: payload.sub, role: payload.role };
    } catch {
      throw unauthorized();
    }
  });

  app.decorate('requireAdmin', async (req: FastifyRequest): Promise<SessionUser> => {
    const user = await app.requireUser(req);
    if (user.role !== 'admin') throw forbidden('Réservé aux administrateurs');
    return user;
  });
});
