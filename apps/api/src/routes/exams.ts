import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { parseInput } from '../errors.js';
import { seriesProgress } from '../services/exams.js';

const query = z.object({ certification: z.string().min(1).max(64) });

/** Série d'examens blancs figés : numéros, titres et progression de l'utilisateur. Jamais les questions. */
export function examRoutes(db: Db) {
  return async (app: FastifyInstance) => {
    app.get('/', async (req) => {
      const user = await app.requireUser(req);
      const { certification } = parseInput(query, req.query);
      return seriesProgress(db, user.id, certification);
    });
  };
}
