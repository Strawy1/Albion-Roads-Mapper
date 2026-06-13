import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupTestApp } from './testApp.js';
import type { FastifyInstance } from 'fastify';

/**
 * RoomSecurityTests
 *
 * Ensures that no actor can access another room's data without a valid token
 * specifically issued for that room. Key scenarios covered:
 *
 * 1. No token → 401 on all protected routes
 * 2. Token for room1 → 403 when attempting to read/modify room2
 * 3. Token for room2 → 403 when attempting to read/modify room1
 */

const ROOM1_ID = 'room-one';
const ROOM2_ID = 'room-two';

const VALID_ZONE_A = 'qiient-al-nusom';
const VALID_ZONE_B = 'qiient-al-odesum';

const testApp = setupTestApp();
let app: FastifyInstance;
let mockDb: any;
let room1Token: string;
let room2Token: string;

beforeEach(() => {
  ({ app, mockDb } = testApp);
  room1Token = app.jwt.sign({ roomId: ROOM1_ID });
  room2Token = app.jwt.sign({ roomId: ROOM2_ID });
});

// ---------------------------------------------------------------------------
// GET /api/rooms/:id/connections
// ---------------------------------------------------------------------------
describe('GET /api/rooms/:id/connections — cross-room isolation', () => {
  it('returns 401 with no token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/rooms/${ROOM1_ID}/connections`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when room2 token is used to read room1 connections', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/rooms/${ROOM1_ID}/connections`,
      headers: { authorization: `Bearer ${room2Token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 when room1 token is used to read room2 connections', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/rooms/${ROOM2_ID}/connections`,
      headers: { authorization: `Bearer ${room1Token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 200 when the correct room token is used', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: ROOM1_ID }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections query

    const res = await app.inject({
      method: 'GET',
      url: `/api/rooms/${ROOM1_ID}/connections`,
      headers: { authorization: `Bearer ${room1Token}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /api/rooms/:id/connections
// ---------------------------------------------------------------------------
describe('POST /api/rooms/:id/connections — cross-room isolation', () => {
  const payload = {
    fromZoneId: VALID_ZONE_A,
    toZoneId: VALID_ZONE_B,
    secondsRemaining: 1800,
    slots: 7,
  };

  it('returns 401 with no token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${ROOM1_ID}/connections`,
      payload,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when room2 token is used to create connection in room1', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${ROOM1_ID}/connections`,
      headers: { authorization: `Bearer ${room2Token}` },
      payload,
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 when room1 token is used to create connection in room2', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${ROOM2_ID}/connections`,
      headers: { authorization: `Bearer ${room1Token}` },
      payload,
    });
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/rooms/:id/connections/:connId
// ---------------------------------------------------------------------------
describe('PATCH /api/rooms/:id/connections/:connId — cross-room isolation', () => {
  it('returns 401 with no token', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${ROOM1_ID}/connections/conn-abc`,
      payload: { secondsRemaining: 3600 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when room2 token is used to patch a connection in room1', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${ROOM1_ID}/connections/conn-abc`,
      headers: { authorization: `Bearer ${room2Token}` },
      payload: { secondsRemaining: 3600 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 when room1 token is used to patch a connection in room2', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${ROOM2_ID}/connections/conn-abc`,
      headers: { authorization: `Bearer ${room1Token}` },
      payload: { secondsRemaining: 3600 },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/rooms/:id/connections/:connId
// ---------------------------------------------------------------------------
describe('DELETE /api/rooms/:id/connections/:connId — cross-room isolation', () => {
  it('returns 401 with no token', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM1_ID}/connections/conn-abc`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when room2 token is used to delete a connection in room1', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM1_ID}/connections/conn-abc`,
      headers: { authorization: `Bearer ${room2Token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 when room1 token is used to delete a connection in room2', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM2_ID}/connections/conn-abc`,
      headers: { authorization: `Bearer ${room1Token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/rooms/:id/connections (full reset)
// ---------------------------------------------------------------------------
describe('DELETE /api/rooms/:id/connections (reset) — cross-room isolation', () => {
  it('returns 401 with no token', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM1_ID}/connections`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when room2 token is used to reset room1', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM1_ID}/connections`,
      headers: { authorization: `Bearer ${room2Token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 when room1 token is used to reset room2', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM2_ID}/connections`,
      headers: { authorization: `Bearer ${room1Token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/rooms/:id/nodes/:zoneId
// ---------------------------------------------------------------------------
describe('DELETE /api/rooms/:id/nodes/:zoneId — cross-room isolation', () => {
  it('returns 401 with no token', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM1_ID}/nodes/${VALID_ZONE_A}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when room2 token is used to delete a node in room1', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM1_ID}/nodes/${VALID_ZONE_A}`,
      headers: { authorization: `Bearer ${room2Token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 when room1 token is used to delete a node in room2', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM2_ID}/nodes/${VALID_ZONE_A}`,
      headers: { authorization: `Bearer ${room1Token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/rooms/:id/memory
// ---------------------------------------------------------------------------
describe('DELETE /api/rooms/:id/memory — cross-room isolation', () => {
  it('returns 401 with no token', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM1_ID}/memory`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when room2 token is used to wipe memory of room1', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM1_ID}/memory`,
      headers: { authorization: `Bearer ${room2Token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 when room1 token is used to wipe memory of room2', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM2_ID}/memory`,
      headers: { authorization: `Bearer ${room1Token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/rooms/:id/memory/:zoneId
// ---------------------------------------------------------------------------
describe('DELETE /api/rooms/:id/memory/:zoneId — cross-room isolation', () => {
  it('returns 401 with no token', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM1_ID}/memory/${VALID_ZONE_A}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when room2 token is used to delete zone memory in room1', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM1_ID}/memory/${VALID_ZONE_A}`,
      headers: { authorization: `Bearer ${room2Token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 when room1 token is used to delete zone memory in room2', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM2_ID}/memory/${VALID_ZONE_A}`,
      headers: { authorization: `Bearer ${room1Token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/rooms/:id (permanent room deletion)
// ---------------------------------------------------------------------------
describe('DELETE /api/rooms/:id — cross-room isolation', () => {
  it('returns 401 with no token', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM1_ID}`,
      payload: { adminPassword: 'secret' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when room2 token is used to delete room1', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM1_ID}`,
      headers: { authorization: `Bearer ${room2Token}` },
      payload: { adminPassword: 'secret' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 when room1 token is used to delete room2', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM2_ID}`,
      headers: { authorization: `Bearer ${room1Token}` },
      payload: { adminPassword: 'secret' },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/rooms/:id/password
// ---------------------------------------------------------------------------
describe('PATCH /api/rooms/:id/password — cross-room isolation', () => {
  it('returns 401 with no token', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${ROOM1_ID}/password`,
      payload: { newPassword: 'newpass', adminPassword: 'adminpass' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when room2 token is used to change room1 password', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${ROOM1_ID}/password`,
      headers: { authorization: `Bearer ${room2Token}` },
      payload: { newPassword: 'newpass', adminPassword: 'adminpass' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 when room1 token is used to change room2 password', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${ROOM2_ID}/password`,
      headers: { authorization: `Bearer ${room1Token}` },
      payload: { newPassword: 'newpass', adminPassword: 'adminpass' },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/rooms/:id/import
// ---------------------------------------------------------------------------
describe('PUT /api/rooms/:id/import — cross-room isolation', () => {
  const importPayload = {
    homeZoneId: 'qiient-hideout',
    connections: [],
    nodePositions: [],
  };

  it('returns 401 with no token', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/rooms/${ROOM1_ID}/import`,
      payload: importPayload,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when room2 token is used to import into room1', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/rooms/${ROOM1_ID}/import`,
      headers: { authorization: `Bearer ${room2Token}` },
      payload: importPayload,
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 when room1 token is used to import into room2', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/rooms/${ROOM2_ID}/import`,
      headers: { authorization: `Bearer ${room1Token}` },
      payload: importPayload,
    });
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Public routes — should remain accessible without a token
// ---------------------------------------------------------------------------
describe('Public routes — no token required', () => {
  it('POST /api/rooms does not require a token', async () => {
    // Any non-401 response (e.g. 400 due to missing body) confirms no auth gate
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: {},
    });
    expect(res.statusCode).not.toBe(401);
  });

  it('POST /api/rooms/:id/auth does not require a token', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // room not found
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${ROOM1_ID}/auth`,
      payload: { password: 'anything' },
    });
    // 404 (room not found) — not 401, confirming auth endpoint is publicly accessible
    expect(res.statusCode).not.toBe(401);
  });

  it('GET /api/rooms/resolve/:slug does not require a token', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // room not found
    const res = await app.inject({
      method: 'GET',
      url: `/api/rooms/resolve/${ROOM1_ID}`,
    });
    expect(res.statusCode).not.toBe(401);
  });

  it('GET /api/slugs/check/:slug does not require a token', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [] });
    const res = await app.inject({
      method: 'GET',
      url: `/api/slugs/check/some-slug`,
    });
    expect(res.statusCode).not.toBe(401);
  });
});
