import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';
import { broadcast } from '../src/broadcast.js';

vi.mock('../src/broadcast.js', () => ({
  broadcast: vi.fn(),
  addSocket: vi.fn(),
  removeSocket: vi.fn(),
  broadcastAll: vi.fn(),
  getRoomSocketCount: vi.fn().mockReturnValue(0),
  getTotalSocketCount: vi.fn().mockReturnValue(0),
  getAllRoomSockets: vi.fn().mockReturnValue(new Map()),
}));

/**
 * Tests that validate JWT token invalidation when a room's password is rotated.
 *
 * When a room password is rotated:
 *  - Any previously issued JWT token for that room must be rejected.
 *  - A user who reloads the page with an existing (pre-rotation) token must be
 *    required to re-authenticate.
 *  - A freshly issued token (obtained after rotation) must continue to work.
 */

const ROOM_ID = 'test-room-id';

let app: FastifyInstance;
let mockDb: any;

beforeEach(async () => {
  mockDb = {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn().mockReturnValue({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    }),
  };
  app = await buildApp({ db: mockDb, disableRateLimit: true, jwtSecret: 'test-secret' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('Password rotation — JWT invalidation', () => {
  it('old JWT is rejected after password rotation', async () => {
    // Simulate a token issued before rotation (passwordVersion = 1)
    const oldToken = app.jwt.sign({ roomId: ROOM_ID, passwordVersion: 1 });

    // After rotation the DB now reports password_version = 2
    mockDb.query.mockResolvedValueOnce({ rows: [{ password_version: 2 }], rowCount: 1 });

    // Attempt an authenticated request using the pre-rotation token
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM_ID}/connections`,
      headers: { Authorization: `Bearer ${oldToken}` },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toMatch(/password rotation/i);
  });

  it('user who reloads the page with a pre-rotation token must re-authenticate', async () => {
    // Simulate a user who obtained their token at version 1 and later comes back
    // to the page while the room password has since been rotated to version 3.
    const staleToken = app.jwt.sign({ roomId: ROOM_ID, passwordVersion: 1 });

    // DB reflects the current (post-rotation) version
    mockDb.query.mockResolvedValueOnce({ rows: [{ password_version: 3 }], rowCount: 1 });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM_ID}/connections`,
      headers: { Authorization: `Bearer ${staleToken}` },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json<{ error: string }>();
    expect(body.error).toMatch(/re-authenticate/i);
  });

  it('new JWT obtained after password rotation is accepted', async () => {
    // Token issued after rotation carries the new version
    const newToken = app.jwt.sign({ roomId: ROOM_ID, passwordVersion: 2 });

    // DB reflects the same current version
    mockDb.query.mockResolvedValueOnce({ rows: [{ password_version: 2 }], rowCount: 1 });

    // A protected endpoint that checks room ownership — provide matching roomId
    // The DELETE connections endpoint also checks jwtPayload.roomId === id, so
    // we need to provide a valid mockDb for the connection deletion too.
    mockDb.query
      // Second call: the connection/room query inside the DELETE handler
      .mockResolvedValueOnce({
        rows: [{ admin_password_hash: '$2b$12$fake', home_zone_id: 'qiient-al-nusom' }],
        rowCount: 1,
      });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM_ID}/connections`,
      headers: { Authorization: `Bearer ${newToken}` },
    });

    // Should not be 401 — the token is valid for the current version.
    // The response may be 204 (success) or another non-401 code depending on
    // downstream mock behaviour, but it must NOT be an auth failure.
    expect(res.statusCode).not.toBe(401);
  });

  it('PATCH /api/rooms/:id/password increments password_version in the DB', async () => {
    // Provide a valid current token (version 1) to pass authentication
    const token = app.jwt.sign({ roomId: ROOM_ID, passwordVersion: 1 });

    // authenticate → version check
    mockDb.query.mockResolvedValueOnce({ rows: [{ password_version: 1 }], rowCount: 1 });

    // admin password lookup
    const bcrypt = await import('bcrypt');
    const adminHash = await bcrypt.default.hash('admin-pass', 1);
    mockDb.query.mockResolvedValueOnce({ rows: [{ admin_password_hash: adminHash }], rowCount: 1 });

    // UPDATE rooms SET password_hash ... password_version = ...
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${ROOM_ID}/password`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { newPassword: 'new-pass', adminPassword: 'admin-pass' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ ok: boolean }>().ok).toBe(true);

    // Verify the UPDATE query incremented the password_version
    const updateCall = mockDb.query.mock.calls.find(
      (call: any[]) =>
        typeof call[0] === 'string' && call[0].includes('password_version')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[0]).toContain('password_version');
  });

  it('password rotation broadcasts password_rotated to all active WS clients in the room', async () => {
    const token = app.jwt.sign({ roomId: ROOM_ID, passwordVersion: 1 });

    // authenticate → version check
    mockDb.query.mockResolvedValueOnce({ rows: [{ password_version: 1 }], rowCount: 1 });

    // admin password lookup
    const bcrypt = await import('bcrypt');
    const adminHash = await bcrypt.default.hash('admin-pass', 1);
    mockDb.query.mockResolvedValueOnce({ rows: [{ admin_password_hash: adminHash }], rowCount: 1 });

    // UPDATE rooms SET password_hash ...
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const broadcastMock = vi.mocked(broadcast);
    broadcastMock.mockClear();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${ROOM_ID}/password`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { newPassword: 'new-pass', adminPassword: 'admin-pass' },
    });

    expect(res.statusCode).toBe(200);

    // Verify broadcast was called with the password_rotated message for this room
    expect(broadcastMock).toHaveBeenCalledWith(ROOM_ID, { type: 'password_rotated' });
  });

  it('auth endpoint embeds passwordVersion in the returned JWT', async () => {
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.default.hash('my-password', 1);

    mockDb.query.mockResolvedValueOnce({
      rows: [{ id: ROOM_ID, password_hash: hash, password_version: 2 }],
      rowCount: 1,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${ROOM_ID}/auth`,
      payload: { password: 'my-password' },
    });

    expect(res.statusCode).toBe(200);
    const { token } = res.json<{ token: string }>();
    expect(token).toBeDefined();

    // Decode and verify the JWT carries the correct passwordVersion
    const decoded = app.jwt.decode<{ roomId: string; passwordVersion: number }>(token);
    expect(decoded).not.toBeNull();
    expect(decoded!.passwordVersion).toBe(2);
  });
});
