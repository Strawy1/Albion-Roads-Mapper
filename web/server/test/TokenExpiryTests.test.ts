import { describe, it, expect, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { setupTestApp } from './testApp.js';
import type { FastifyInstance } from 'fastify';

/**
 * TokenExpiryTests
 *
 * Ensures that expired JWT tokens are rejected with 401 on protected routes.
 * A sample of representative routes is tested — one per resource area.
 */

const ROOM_ID = 'room-one';
const ZONE_ID = 'qiient-al-nusom';

/** Build a HS256 JWT whose `exp` is set in the past so it is already expired. */
function makeExpiredToken(secret: string, roomId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({ roomId, iat: nowSec - 7200, exp: nowSec - 3600 }),
  ).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const signature = createHmac('sha256', secret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

const testApp = setupTestApp();
let app: FastifyInstance;
let expiredToken: string;

beforeEach(() => {
  ({ app } = testApp);
  expiredToken = makeExpiredToken('test-secret', ROOM_ID);
});

describe('Expired token — GET /api/rooms/:id/connections', () => {
  it('returns 401 when token has expired', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/rooms/${ROOM_ID}/connections`,
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('Expired token — POST /api/rooms/:id/connections', () => {
  it('returns 401 when token has expired', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${ROOM_ID}/connections`,
      headers: { authorization: `Bearer ${expiredToken}` },
      payload: {
        fromZoneId: ZONE_ID,
        toZoneId: 'qiient-al-odesum',
        secondsRemaining: 1800,
        slots: 7,
      },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('Expired token — PATCH /api/rooms/:id/connections/:connId', () => {
  it('returns 401 when token has expired', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${ROOM_ID}/connections/conn-abc`,
      headers: { authorization: `Bearer ${expiredToken}` },
      payload: { secondsRemaining: 3600 },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('Expired token — DELETE /api/rooms/:id/connections/:connId', () => {
  it('returns 401 when token has expired', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM_ID}/connections/conn-abc`,
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('Expired token — DELETE /api/rooms/:id/connections (reset)', () => {
  it('returns 401 when token has expired', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM_ID}/connections`,
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('Expired token — DELETE /api/rooms/:id/nodes/:zoneId', () => {
  it('returns 401 when token has expired', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM_ID}/nodes/${ZONE_ID}`,
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('Expired token — DELETE /api/rooms/:id/memory', () => {
  it('returns 401 when token has expired', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM_ID}/memory`,
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('Expired token — DELETE /api/rooms/:id', () => {
  it('returns 401 when token has expired', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM_ID}`,
      headers: { authorization: `Bearer ${expiredToken}` },
      payload: { adminPassword: 'secret' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('Expired token — PATCH /api/rooms/:id/password', () => {
  it('returns 401 when token has expired', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${ROOM_ID}/password`,
      headers: { authorization: `Bearer ${expiredToken}` },
      payload: { newPassword: 'newpass', adminPassword: 'adminpass' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('Expired token — PUT /api/rooms/:id/import', () => {
  it('returns 401 when token has expired', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/rooms/${ROOM_ID}/import`,
      headers: { authorization: `Bearer ${expiredToken}` },
      payload: {
        homeZoneId: 'qiient-hideout',
        connections: [],
        nodePositions: [],
      },
    });
    expect(res.statusCode).toBe(401);
  });
});
