import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { responseSchema } from '@examforge/core';
import type { Db } from '../db/client.js';
import { parseInput } from '../errors.js';
import {
  answerQuestion,
  getAttemptResult,
  getAttemptState,
  listAttempts,
  startAttempt,
  submitAttempt,
} from '../services/attempts.js';

const startSchema = z.object({
  certification: z.string().min(1).max(64),
  mode: z.enum(['exam', 'practice']),
  examNumber: z.number().int().positive().optional(),
  questionCount: z.number().int().min(1).max(200).optional(),
  domains: z.array(z.string().max(16)).max(20).optional(),
});

const answerSchema = z
  .object({
    response: responseSchema.nullable().optional(),
    flagged: z.boolean().optional(),
    secondsSpent: z.number().int().min(0).max(86_400).optional(),
  })
  .refine((v) => v.response !== undefined || v.flagged !== undefined || v.secondsSpent !== undefined, {
    message: 'Rien à enregistrer',
  });

const idParam = z.object({ id: z.string().uuid() });
const answerParams = idParam.extend({ questionId: z.string().uuid() });

export function attemptRoutes(db: Db) {
  return async (app: FastifyInstance) => {
    app.get('/', async (req) => {
      const user = await app.requireUser(req);
      return { attempts: await listAttempts(db, user.id) };
    });

    app.post('/', async (req, reply) => {
      const user = await app.requireUser(req);
      const input = parseInput(startSchema, req.body);
      const attempt = await startAttempt(db, user.id, input);
      return reply.code(201).send(await getAttemptState(db, attempt.id, user.id));
    });

    app.get('/:id', async (req) => {
      const user = await app.requireUser(req);
      const { id } = parseInput(idParam, req.params);
      return getAttemptState(db, id, user.id);
    });

    app.put('/:id/answers/:questionId', async (req) => {
      const user = await app.requireUser(req);
      const { id, questionId } = parseInput(answerParams, req.params);
      const input = parseInput(answerSchema, req.body);
      return answerQuestion(db, id, user.id, questionId, input);
    });

    app.post('/:id/submit', async (req) => {
      const user = await app.requireUser(req);
      const { id } = parseInput(idParam, req.params);
      return submitAttempt(db, id, user.id);
    });

    app.get('/:id/result', async (req) => {
      const user = await app.requireUser(req);
      const { id } = parseInput(idParam, req.params);
      return getAttemptResult(db, id, user.id);
    });
  };
}
