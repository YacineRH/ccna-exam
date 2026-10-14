import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { parseInput } from '../errors.js';
import { getStats } from '../services/stats.js';

const query = z.object({ certification: z.string().min(1).max(64) });

export function statsRoutes(db: Db) {
  return async (app: FastifyInstance) => {
    app.get('/', async (req) => {
      const user = await app.requireUser(req);
      const { certification } = parseInput(query, req.query);
      return getStats(db, user.id, certification);
    });
  };
}
