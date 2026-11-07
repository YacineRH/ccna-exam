import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { parseInput } from '../errors.js';
import {
  finishLabAttempt,
  getLab,
  getLabAttemptState,
  listLabAttempts,
  listLabs,
  revealHint,
  runLabCommands,
  startLabAttempt,
} from '../services/labs.js';

const certQuery = z.object({ certification: z.string().min(1).max(64) });
const historyQuery = z.object({ certification: z.string().min(1).max(64).optional() });
const slugParam = z.object({ slug: z.string().regex(/^[a-z0-9.-]+$/).max(120) });
const idParam = z.object({ id: z.string().uuid() });
const commandSchema = z.object({
  device: z.string().min(1).max(32).optional(),
  /** Une ligne, ou plusieurs (collage) ; « \u001a » vaut Ctrl+Z. */
  input: z.string().max(20_000),
});

/** `GET /labs`, `GET /labs/:slug`, `POST /labs/:slug/attempts`. */
export function labRoutes(db: Db) {
  return async (app: FastifyInstance) => {
    app.get('/', async (req) => {
      const user = await app.requireUser(req);
      const { certification } = parseInput(certQuery, req.query);
      return listLabs(db, user.id, certification);
    });

    app.get('/:slug', async (req) => {
      const user = await app.requireUser(req);
      const { slug } = parseInput(slugParam, req.params);
      return getLab(db, user.id, slug);
    });

    app.post('/:slug/attempts', async (req, reply) => {
      const user = await app.requireUser(req);
      const { slug } = parseInput(slugParam, req.params);
      return reply.code(201).send(await startLabAttempt(db, user.id, slug));
    });
  };
}

/** Sessions de lab : `GET /lab-attempts`, état, commandes, indices, fin. */
export function labAttemptRoutes(db: Db) {
  return async (app: FastifyInstance) => {
    app.get('/', async (req) => {
      const user = await app.requireUser(req);
      const { certification } = parseInput(historyQuery, req.query);
      return { attempts: await listLabAttempts(db, user.id, certification ? { certification } : {}) };
    });

    app.get('/:id', async (req) => {
      const user = await app.requireUser(req);
      const { id } = parseInput(idParam, req.params);
      return getLabAttemptState(db, id, user.id);
    });

    app.post('/:id/commands', async (req) => {
      const user = await app.requireUser(req);
      const { id } = parseInput(idParam, req.params);
      const body = parseInput(commandSchema, req.body);
      return runLabCommands(db, id, user.id, body.device !== undefined ? { device: body.device, input: body.input } : { input: body.input });
    });

    app.post('/:id/hint', async (req) => {
      const user = await app.requireUser(req);
      const { id } = parseInput(idParam, req.params);
      return revealHint(db, id, user.id);
    });

    app.post('/:id/finish', async (req) => {
      const user = await app.requireUser(req);
      const { id } = parseInput(idParam, req.params);
      return finishLabAttempt(db, id, user.id);
    });
  };
}
