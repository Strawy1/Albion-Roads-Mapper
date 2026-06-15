import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import { Pool } from 'pg';
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
      'https://albion-mapper-client-git-beta-maelstromeous-projects.vercel.app',
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

      // Validate that the token's passwordVersion matches the current DB value,
      // ensuring tokens are invalidated when a room's password is rotated.
      const payload = request.user as { roomId?: string; passwordVersion?: number };
      if (payload.roomId && payload.passwordVersion !== undefined) {
        const { rows } = await db.query<{ password_version: number }>(
          'SELECT password_version FROM rooms WHERE id = $1',
          [payload.roomId]
        );
        const currentVersion = rows[0]?.password_version ?? 1;
        if (payload.passwordVersion !== currentVersion) {
          return reply.status(401).send({ error: 'Token invalidated due to password rotation. Please re-authenticate.' });
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
