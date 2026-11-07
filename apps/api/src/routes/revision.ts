import { responseSchema } from '@examforge/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { parseInput } from '../errors.js';
import { answerRevisionCard, enrollDeck, getRevisionSession, listRevisionSessions, revisionOverview, startRevisionSession } from '../services/revision.js';

const certQuery = z.object({ certification: z.string().min(1).max(64) });
const historyQuery = z.object({ certification: z.string().min(1).max(64).optional() });
const subtopicCode = z.string().min(1).max(32);
const deckSchema = z.object({ certification: z.string().min(1).max(64), subtopic: subtopicCode });
const startSchema = z.object({
  certification: z.string().min(1).max(64),
  subtopic: subtopicCode.optional(),
  limit: z.number().int().min(1).max(20).optional(),
});
const idParam = z.object({ id: z.string().uuid() });
const answerSchema = z.object({
  questionId: z.string().uuid(),
  response: responseSchema,
  /** Décalage horaire du navigateur (`Date#getTimezoneOffset`) : les échéances tombent à minuit, heure locale. */
  tzOffsetMinutes: z.number().int().min(-840).max(840).optional(),
});

/** Révision espacée : `GET /revision`, paquets, sessions, réponses. */
export function revisionRoutes(db: Db) {
  return async (app: FastifyInstance) => {
    app.get('/', async (req) => {
      const user = await app.requireUser(req);
      const { certification } = parseInput(certQuery, req.query);
      return revisionOverview(db, user.id, certification);
    });

    app.post('/decks', async (req, reply) => {
      const user = await app.requireUser(req);
      const { certification, subtopic } = parseInput(deckSchema, req.body);
      return reply.code(201).send(await enrollDeck(db, user.id, certification, subtopic));
    });

    app.get('/sessions', async (req) => {
      const user = await app.requireUser(req);
      const { certification } = parseInput(historyQuery, req.query);
      return { sessions: await listRevisionSessions(db, user.id, certification ? { certification } : {}) };
    });

    app.post('/sessions', async (req, reply) => {
      const user = await app.requireUser(req);
      const input = parseInput(startSchema, req.body);
      return reply.code(201).send(
        await startRevisionSession(db, user.id, {
          certification: input.certification,
          ...(input.subtopic ? { subtopic: input.subtopic } : {}),
          ...(input.limit ? { limit: input.limit } : {}),
        }),
      );
    });

    app.get('/sessions/:id', async (req) => {
      const user = await app.requireUser(req);
      const { id } = parseInput(idParam, req.params);
      return getRevisionSession(db, id, user.id);
    });

    app.post('/sessions/:id/answers', async (req) => {
      const user = await app.requireUser(req);
      const { id } = parseInput(idParam, req.params);
      const input = parseInput(answerSchema, req.body);
      return answerRevisionCard(db, id, user.id, {
        questionId: input.questionId,
        response: input.response,
        ...(input.tzOffsetMinutes !== undefined ? { tzOffsetMinutes: input.tzOffsetMinutes } : {}),
      });
    });
  };
}
