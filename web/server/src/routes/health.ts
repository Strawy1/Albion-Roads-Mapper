import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async (_request, reply) => {
    const { rows } = await app.db.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM rooms'
    );
    return reply.send({ status: 'ok', roomCount: parseInt(rows[0].count, 10) });
  });

  // Opaque "reload generation" token the client snapshots on load and polls.
  // When the stored value changes (bumped by hand in the DB) every client that
  // loaded an older value reloads on its next poll. Unauthenticated (like
  // /api/health) so it works for users not inside a room, and never cached.
  app.get('/api/version', async (_request, reply) => {
    const { rows } = await app.db.query<{ value: string }>(
      "SELECT value FROM app_settings WHERE key = 'client_version'"
    );
    const version = rows[0]?.value ?? '1';
    return reply.header('Cache-Control', 'no-store').send({ version });
  });
}
