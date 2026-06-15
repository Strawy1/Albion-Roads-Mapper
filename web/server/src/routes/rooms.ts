import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import {
  CreateRoomBodySchema,
  AuthRoomBodySchema,
  ChangePasswordBodySchema,
  ImportRoomBodySchema,
  ZONE_BY_ID,
} from 'shared';
import { broadcast } from '../broadcast.js';
import { getInitialFeatures } from '../utils/nodeFeatures.js';
import {
  trackRoomCreated,
  trackPasswordRotated,
  trackRoomReset,
  trackMemoryWipedFull,
  trackMemoryWipedSingle,
  trackRoomDeleted,
  trackRoomModified,
} from './rooms_analytics.js';

const BCRYPT_ROUNDS = 12;

function formatZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue.path.length > 0 ? issue.path.join('.') : 'body';
  return `Validation error at ${path}: ${issue.message}`;
}

export async function roomRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/rooms/resolve/:slug — kept for backward compatibility, returns the slug as-is
  app.get<{ Params: { slug: string } }>('/api/rooms/resolve/:slug', async (request, reply) => {
    const { slug } = request.params;
    const { rows } = await app.db.query<{ id: string }>(
      'SELECT id FROM rooms WHERE id = $1',
      [slug]
    );
    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Room not found' });
    }
    return reply.send({ id: rows[0].id });
  });

  // GET /api/slugs/check/:slug — check if a vanity URL slug is available
  app.get<{ Params: { slug: string } }>('/api/slugs/check/:slug', async (request, reply) => {
    const { slug } = request.params;
    if (!/^[a-z0-9-]+$/.test(slug) || slug.length < 1 || slug.length > 100) {
      return reply.status(400).send({ error: 'Invalid slug format' });
    }
    const { rows } = await app.db.query<{ id: string }>(
      'SELECT id FROM rooms WHERE id = $1',
      [slug]
    );
    return reply.send({ available: rows.length === 0 });
  });

  // POST /api/rooms — create a room
  app.post('/api/rooms', async (request, reply) => {
    const parsed = CreateRoomBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: formatZodError(parsed.error) });
    }

    const { password, adminPassword, homeZoneId, title, vanityUrl } = parsed.data;

    const zone = ZONE_BY_ID.get(homeZoneId);
    if (!zone) {
      return reply.status(400).send({ error: 'homeZoneId not found in zone catalogue' });
    }

    if (!zone.isRoadsHome) {
      return reply.status(400).send({ error: 'homeZoneId is not a valid roads home' });
    }

    const id = vanityUrl;
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const adminPasswordHash = await bcrypt.hash(adminPassword, BCRYPT_ROUNDS);
    const createdAt = new Date().toISOString();

    const client = await app.db.connect();
    try {
      await client.query('BEGIN');
      const { rows: existing } = await client.query<{ id: string }>(
        'SELECT id FROM rooms WHERE id = $1',
        [id]
      );
      if (existing.length > 0) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Vanity URL is already taken' });
      }

      await client.query(`
        INSERT INTO rooms (id, password_hash, admin_password_hash, home_zone_id, title, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [id, passwordHash, adminPasswordHash, homeZoneId, title || null, createdAt]);

      await client.query(`
        INSERT INTO room_node_positions (room_id, zone_id, x, y, features, custom_handles, rotation)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [id, homeZoneId, 0, 0, JSON.stringify(getInitialFeatures(homeZoneId)), JSON.stringify(null), 0]);

      await client.query(`
        INSERT INTO room_node_memory (room_id, zone_id, features, times_added, rotation)
        VALUES ($1, $2, $3, ARRAY[$4::timestamptz], $5)
      `, [id, homeZoneId, JSON.stringify(getInitialFeatures(homeZoneId)), createdAt, 0]);

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    trackRoomCreated(app.db);

    const shareUrl = `${request.protocol}://${request.hostname}/rooms/${id}`;
    return reply.status(201).send({ id, shareUrl });
  });

  // POST /api/rooms/:id/auth — authenticate and get JWT
  app.post<{ Params: { id: string } }>('/api/rooms/:id/auth', async (request, reply) => {
    const { id } = request.params;
    const parsed = AuthRoomBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: formatZodError(parsed.error) });
    }

    const { rows } = await app.db.query<{ id: string; password_hash: string; home_zone_id: string; created_at: string; password_version: number }>(
      'SELECT id, password_hash, home_zone_id, created_at, password_version FROM rooms WHERE id = $1',
      [id]
    );
    const room = rows[0];

    if (!room) {
      return reply.status(404).send({ error: 'Room not found' });
    }

    const valid = await bcrypt.compare(parsed.data.password, room.password_hash);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid password' });
    }

    const token = app.jwt.sign({ roomId: room.id, passwordVersion: room.password_version ?? 1 }, { expiresIn: '7d' });
    return reply.send({ token });
  });


  // PATCH /api/rooms/:id/password — change room password
  app.patch<{ Params: { id: string } }>('/api/rooms/:id/password', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const jwtPayload = request.user as { roomId: string };
    if (jwtPayload.roomId !== id) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const parsed = ChangePasswordBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: formatZodError(parsed.error) });
    }
    const { newPassword, adminPassword } = parsed.data;
    
    // Check adminPassword
    const { rows } = await app.db.query<{ admin_password_hash: string }>(
      'SELECT admin_password_hash FROM rooms WHERE id = $1',
      [id]
    );
    const room = rows[0];
    if (!room) {
      return reply.status(404).send({ error: 'Room not found' });
    }
    const validAdmin = await bcrypt.compare(adminPassword, room.admin_password_hash);
    if (!validAdmin) {
      return reply.status(401).send({ error: 'Invalid admin password' });
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const result = await app.db.query(
      'UPDATE rooms SET password_hash = $1, password_version = COALESCE(password_version, 1) + 1 WHERE id = $2',
      [passwordHash, id]
    );
    if (result.rowCount === 0) {
      return reply.status(404).send({ error: 'Room not found' });
    }

    // Immediately boot all active WebSocket clients in this room
    broadcast(id, { type: 'password_rotated' });
    trackPasswordRotated(app.db);

    return reply.send({ ok: true });
  });

  // DELETE /api/rooms/:id/connections — reset (delete all connections in room)
  app.delete<{ Params: { id: string }; Body: { adminPassword?: string } }>('/api/rooms/:id/connections', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const jwtPayload = request.user as { roomId: string };
    if (jwtPayload.roomId !== id) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { adminPassword } = request.body ?? {};

    const client = await app.db.connect();
    try {
      await client.query('BEGIN');
      
      const { rows: rooms } = await client.query<{ admin_password_hash: string; home_zone_id: string }>(
        'SELECT admin_password_hash, home_zone_id FROM rooms WHERE id = $1 FOR UPDATE',
        [id]
      );
      const room = rooms[0];
      if (!room) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ error: 'Room not found' });
      }

      if (adminPassword) {
        const validAdmin = await bcrypt.compare(adminPassword, room.admin_password_hash);
        if (!validAdmin) {
          await client.query('ROLLBACK');
          return reply.status(401).send({ error: 'Invalid admin password' });
        }
      }

      await client.query('DELETE FROM connections WHERE room_id = $1', [id]);
      await client.query('DELETE FROM room_node_positions WHERE room_id = $1 AND zone_id != $2', [id, room.home_zone_id]);
      await client.query(
        'UPDATE room_node_positions SET features = $1, custom_handles = $2 WHERE room_id = $3 AND zone_id = $4',
        ['{}', null, id, room.home_zone_id]
      );
      await client.query('UPDATE rooms SET updated_at = $1 WHERE id = $2', [new Date().toISOString(), id]);
      
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    broadcast(id, { type: 'room_reset' });
    trackRoomReset(app.db);

    return reply.status(204).send();
  });

  // DELETE /api/rooms/:id/memory — flush all zone memory for a room
  app.delete<{ Params: { id: string }; Body: { adminPassword?: string } }>('/api/rooms/:id/memory', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const jwtPayload = request.user as { roomId: string };
    if (jwtPayload.roomId !== id) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { adminPassword } = request.body ?? {};
    if (!adminPassword) {
      return reply.status(400).send({ error: 'Admin password required' });
    }
    const { rows } = await app.db.query<{ admin_password_hash: string }>(
      'SELECT admin_password_hash FROM rooms WHERE id = $1',
      [id]
    );
    if (!rows[0]) {
      return reply.status(404).send({ error: 'Room not found' });
    }
    const validAdmin = await bcrypt.compare(adminPassword, rows[0].admin_password_hash);
    if (!validAdmin) {
      return reply.status(401).send({ error: 'Invalid admin password' });
    }

    await app.db.query('DELETE FROM room_node_memory WHERE room_id = $1', [id]);

    broadcast(id, { type: 'memory_sync', memory: [] });
    trackMemoryWipedFull(app.db);

    return reply.status(204).send();
  });

  // DELETE /api/rooms/:id/memory/:zoneId — delete a single zone's memory
  app.delete<{ Params: { id: string; zoneId: string } }>('/api/rooms/:id/memory/:zoneId', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { id, zoneId } = request.params;
    const jwtPayload = request.user as { roomId: string };
    if (jwtPayload.roomId !== id) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    await app.db.query('DELETE FROM room_node_memory WHERE room_id = $1 AND zone_id = $2', [id, zoneId]);

    broadcast(id, { type: 'memory_deleted', zoneId });
    trackMemoryWipedSingle(app.db);

    return reply.status(204).send();
  });

  // DELETE /api/rooms/:id — permanently delete the room and all its data
  app.delete<{ Params: { id: string }; Body: { adminPassword: string } }>('/api/rooms/:id', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const jwtPayload = request.user as { roomId: string };
    if (jwtPayload.roomId !== id) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { adminPassword } = request.body ?? {};
    if (!adminPassword) {
      return reply.status(400).send({ error: 'Admin password required' });
    }

    const { rows } = await app.db.query<{ admin_password_hash: string }>(
      'SELECT admin_password_hash FROM rooms WHERE id = $1',
      [id]
    );
    const room = rows[0];
    if (!room) {
      return reply.status(404).send({ error: 'Room not found' });
    }
    const validAdmin = await bcrypt.compare(adminPassword, room.admin_password_hash);
    if (!validAdmin) {
      return reply.status(401).send({ error: 'Invalid admin password' });
    }

    const client = await app.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM connections WHERE room_id = $1', [id]);
      await client.query('DELETE FROM room_node_positions WHERE room_id = $1', [id]);
      await client.query('DELETE FROM room_node_memory WHERE room_id = $1', [id]);
      await client.query('DELETE FROM rooms WHERE id = $1', [id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    broadcast(id, { type: 'room_deleted' });
    trackRoomDeleted(app.db);

    return reply.status(204).send();
  });

  // PUT /api/rooms/:id/import — import full room state
  app.put<{ Params: { id: string }, Body: any }>('/api/rooms/:id/import', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const jwtPayload = request.user as { roomId: string };
    if (jwtPayload.roomId !== id) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    
    const parsed = ImportRoomBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: formatZodError(parsed.error) });
    }

    const { homeZoneId, connections, nodePositions, roomHistory } = parsed.data;

    // Validate homeZoneId
    const zone = ZONE_BY_ID.get(homeZoneId);
    if (!zone || zone.type !== 'roadsHideout') {
      return reply.status(400).send({ error: 'Invalid hideout zone' });
    }

    const client = await app.db.connect();
    try {
      await client.query('BEGIN');
      
      // Update room homeZoneId
      await client.query('UPDATE rooms SET home_zone_id = $1, updated_at = $2 WHERE id = $3', [homeZoneId, new Date().toISOString(), id]);

      // Delete all existing data
      await client.query('DELETE FROM connections WHERE room_id = $1', [id]);
      await client.query('DELETE FROM room_node_positions WHERE room_id = $1', [id]);
      await client.query('DELETE FROM room_node_memory WHERE room_id = $1', [id]);
      
      // Insert new connections
      for (const conn of connections) {
        await client.query(`
          INSERT INTO connections (id, room_id, from_zone_id, to_zone_id, from_handle_id, to_handle_id, expires_at, reported_at, reported_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [nanoid(), id, conn.fromZoneId, conn.toZoneId, conn.fromHandleId, conn.toHandleId, conn.expiresAt, conn.reportedAt || new Date().toISOString(), conn.reportedBy || null]);
      }
      
      // Insert new node positions
      for (const node of nodePositions) {
        await client.query(`
          INSERT INTO room_node_positions (room_id, zone_id, x, y, features, custom_handles, explored, rotation)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [id, node.zoneId, node.x, node.y, JSON.stringify(node.features || {}), JSON.stringify(node.customHandles || null), !!node.explored, node.rotation ?? 0]);
      }

      // Insert new room memory (roads only)
      if (roomHistory) {
        for (const entry of roomHistory) {
          const zone = ZONE_BY_ID.get(entry.zoneId);
          if (zone?.type !== 'roads' && zone?.type !== 'roadsHideout') continue;

          await client.query(`
            INSERT INTO room_node_memory (room_id, zone_id, times_added, features, custom_handles, rotation, last_updated)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [id, entry.zoneId, entry.timesAdded, JSON.stringify(entry.features || {}), JSON.stringify(entry.customHandles || null), entry.rotation ?? 0, entry.lastUpdated]);
        }
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    
    broadcast(id, { type: 'room_reset' });
    trackRoomModified(app.db, id);

    return reply.status(204).send();
  });
}
