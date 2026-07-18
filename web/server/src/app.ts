import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import { Pool } from 'pg';
import type { RoomTokenPayload } from 'shared';
import { fetchRoomGuardState } from './utils/roomGuard.js';
import { roomRoutes } from './routes/rooms.js';
import { connectionRoutes } from './routes/connections.js';
import { wsRoutes } from './ws.js';
import { healthRoutes } from './routes/health.js';
import { mediaRoutes } from './routes/media.js';
import { metricsRoutes } from './routes/metrics.js';

export interface AppOptions {
  db: Pool;
  jwtSecret?: string;
  logger?: boolean;
  disableRateLimit?: boolean;
}

export async function buildApp(options: AppOptions) {
  const {
    db,
    jwtSecret = (typeof process !== 'undefined' ? process.env?.['JWT_SECRET'] : undefined) ?? 'change-me-in-production',
    logger = false,
    disableRateLimit = false,
  } = options;

  const app = Fastify({ logger });

  // CORS
  await app.register(fastifyCors, {
    origin: [
      'https://albion-mapper-client.vercel.app',
      'https://albion-mapper-client-git-testing-maelstromeous-projects.vercel.app',
      /^https:\/\/albion-roads-mapper-[a-z0-9]+-maelstromeous-projects\.vercel\.app$/,
      'http://10.0.5.2',
      'https://10.0.5.2',
      /^http:\/\/localhost(:\d+)?$/,
      /^https?:\/\/([a-zA-Z0-9-]+\.)?albionroads\.live$/
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  });

  // Decorate with db
  app.decorate('db', db);

  // JWT
  await app.register(fastifyJwt, { secret: jwtSecret });

  // Authenticate helper
  app.decorate(
    'authenticate',
    async function (
      request: Parameters<(typeof app)['authenticate']>[0],
      reply: Parameters<(typeof app)['authenticate']>[1],
    ) {
      try {
        await request.jwtVerify();
      } catch {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const payload = request.user as RoomTokenPayload;
      if (payload.roomId) {
        const guard = await fetchRoomGuardState(db, payload.roomId);

        // Validate that the token's passwordVersion matches the current DB value,
        // ensuring tokens are invalidated when a room's password is rotated.
        if (guard && payload.passwordVersion !== undefined && payload.passwordVersion !== guard.passwordVersion) {
          return reply.status(401).send({ error: 'Token invalidated due to password rotation. Please re-authenticate.' });
        }

        // Locked rooms are read-only: every mutating request requires an
        // admin-role token. The role can only be set by the server after
        // verifying the room's admin password (POST /api/rooms/:id/auth/admin).
        const isReadOnlyMethod = request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS';
        if (guard?.locked && !isReadOnlyMethod && payload.role !== 'admin') {
          return reply.status(403).send({ error: 'Room is locked' });
        }
      }
    },
  );

  // Rate limiting
  if (!disableRateLimit) {
    await app.register(fastifyRateLimit, { global: false });
  }

  // WebSocket
  await app.register(fastifyWebsocket);

  // Route plugins
  await app.register(roomRoutes, { prefix: '' });
  await app.register(connectionRoutes, { prefix: '' });
  await app.register(wsRoutes, { prefix: '' });
  await app.register(healthRoutes, { prefix: '' });
  await app.register(mediaRoutes, { prefix: '' });
  await app.register(metricsRoutes, { prefix: '' });

  return app;
}
