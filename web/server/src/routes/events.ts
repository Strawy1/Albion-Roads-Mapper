import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { EventBodySchema } from 'shared';
import { incrementEvent } from '../analytics.js';

function formatZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue.path.length > 0 ? issue.path.join('.') : 'body';
  return `Validation error at ${path}: ${issue.message}`;
}

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/events — generic client analytics event ingestion.
  // Deliberately unauthenticated: events also fire in locked rooms, where the
  // room guard would 403 any mutating request from a non-admin token. The slug
  // schema and the rate limit are the abuse guards instead.
  app.post('/api/events', {
    config: { rateLimit: { max: 120, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const parsed = EventBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: formatZodError(parsed.error) });
    }

    incrementEvent(app.db, parsed.data.type);
    return reply.send({ ok: true });
  });
}
