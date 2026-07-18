import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import bcrypt from 'bcrypt';
import { setupTestApp } from './testApp.js';
import type { FastifyInstance } from 'fastify';

/**
 * Room lock security tests.
 *
 * A room can be locked by an admin, making it read-only for everyone who does
 * not hold an admin-role token. Admin tokens are minted exclusively by
 * POST /api/rooms/:id/auth/admin after verifying the room's ADMIN password.
 *
 * Covered here:
 *  - Admin auth only accepts the admin password (never the room password),
 *    scoped strictly to the room in the URL, and leaks no credentials.
 *  - The admin role cannot be forged, upgraded into, or borrowed cross-room.
 *  - Locked rooms reject every mutating HTTP request and WS operation from
 *    non-admin tokens, while reads and broadcasts keep working.
 */

const VALID_ZONE_A = 'adrens-hill';

const ADMIN_PASSWORD = 'super-secret-admin';
const ROOM_PASSWORD = 'regular-room-password';

const testApp = setupTestApp();
const { roomId } = testApp;
let app: FastifyInstance;
let mockDb: any;
let token: string;
let adminPasswordHash: string;
let roomPasswordHash: string;

beforeEach(async () => {
  ({ app, mockDb, token } = testApp);
  adminPasswordHash = await bcrypt.hash(ADMIN_PASSWORD, 1);
  roomPasswordHash = await bcrypt.hash(ROOM_PASSWORD, 1);
});

function lockRoom(locked = true, passwordVersion = 1) {
  testApp.guardRows = [{ password_version: passwordVersion, locked }];
}

function signAdminToken(id: string = roomId): string {
  return app.jwt.sign({ roomId: id, passwordVersion: 1, role: 'admin' });
}

/** Re-encode a JWT with a tampered payload but the original (now-invalid) signature. */
function tamperToken(jwt: string, mutate: (payload: Record<string, unknown>) => void): string {
  const [header, payload, signature] = jwt.split('.');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
  mutate(decoded);
  const forgedPayload = Buffer.from(JSON.stringify(decoded)).toString('base64url');
  return `${header}.${forgedPayload}.${signature}`;
}

/** JWT signed with a wrong secret, claiming the admin role. */
function foreignSignedAdminToken(id: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ roomId: id, passwordVersion: 1, role: 'admin' })).toString('base64url');
  const signature = createHmac('sha256', 'attacker-secret').update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

// ---------------------------------------------------------------------------
// POST /api/rooms/:id/auth/admin
// ---------------------------------------------------------------------------
describe('POST /api/rooms/:id/auth/admin', () => {
  function mockAdminAuthRoom() {
    mockDb.query.mockResolvedValueOnce({
      rows: [{ id: roomId, admin_password_hash: adminPasswordHash, password_version: 3 }],
      rowCount: 1,
    });
  }

  it('issues an admin-role token for the correct admin password', async () => {
    mockAdminAuthRoom();
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/auth/admin`,
      payload: { adminPassword: ADMIN_PASSWORD },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ token: string }>();
    // No credential leakage: the response carries the token and nothing else.
    expect(Object.keys(body)).toEqual(['token']);

    const decoded = app.jwt.verify<{ roomId: string; passwordVersion: number; role?: string }>(body.token);
    expect(decoded.roomId).toBe(roomId);
    expect(decoded.role).toBe('admin');
    expect(decoded.passwordVersion).toBe(3);
  });

  it('queries only the room in the URL — admin passwords cannot cross-pollinate between rooms', async () => {
    mockAdminAuthRoom();
    await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/auth/admin`,
      payload: { adminPassword: ADMIN_PASSWORD },
    });

    const call = mockDb.query.mock.calls.find((c: any[]) => typeof c[0] === 'string' && c[0].includes('admin_password_hash'));
    expect(call).toBeDefined();
    expect(call[1]).toEqual([roomId]);
  });

  it('rejects a wrong admin password with 401 and no token', async () => {
    mockAdminAuthRoom();
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/auth/admin`,
      payload: { adminPassword: 'not-the-admin-password' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).not.toHaveProperty('token');
  });

  it('rejects the ROOM password — only the admin password mints admin tokens', async () => {
    // Row deliberately includes the room password hash too: the route must
    // compare against admin_password_hash, never password_hash.
    mockDb.query.mockResolvedValueOnce({
      rows: [{ id: roomId, password_hash: roomPasswordHash, admin_password_hash: adminPasswordHash, password_version: 1 }],
      rowCount: 1,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/auth/admin`,
      payload: { adminPassword: ROOM_PASSWORD },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for an unknown room', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/does-not-exist/auth/admin`,
      payload: { adminPassword: ADMIN_PASSWORD },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 when adminPassword is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/auth/admin`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('regular /auth tokens never carry a role claim, even if one is smuggled into the body', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{ id: roomId, password_hash: roomPasswordHash, home_zone_id: VALID_ZONE_A, created_at: new Date().toISOString(), password_version: 1 }],
      rowCount: 1,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/auth`,
      payload: { password: ROOM_PASSWORD, role: 'admin' },
    });
    expect(res.statusCode).toBe(200);
    const decoded = app.jwt.verify<{ role?: string }>(res.json<{ token: string }>().token);
    expect(decoded.role).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/rooms/:id/lock
// ---------------------------------------------------------------------------
describe('PATCH /api/rooms/:id/lock', () => {
  it('rejects a regular (non-admin) token with 403', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${roomId}/lock`,
      headers: { authorization: `Bearer ${token}` },
      payload: { locked: true },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: string }>().error).toMatch(/admin token/i);
    // No UPDATE must have been issued.
    const update = mockDb.query.mock.calls.find((c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE rooms SET locked'));
    expect(update).toBeUndefined();
  });

  it("rejects another room's admin token with 403", async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${roomId}/lock`,
      headers: { authorization: `Bearer ${signAdminToken('some-other-room')}` },
      payload: { locked: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a token whose payload was tampered to add the admin role', async () => {
    const forged = tamperToken(token, (p) => { p.role = 'admin'; });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${roomId}/lock`,
      headers: { authorization: `Bearer ${forged}` },
      payload: { locked: true },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an admin-role token signed with the wrong secret', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${roomId}/lock`,
      headers: { authorization: `Bearer ${foreignSignedAdminToken(roomId)}` },
      payload: { locked: true },
    });
    expect(res.statusCode).toBe(401);
  });

  it('locks the room with a valid admin token', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE rooms SET locked
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${roomId}/lock`,
      headers: { authorization: `Bearer ${signAdminToken()}` },
      payload: { locked: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, locked: true });

    const update = mockDb.query.mock.calls.find((c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE rooms SET locked'));
    expect(update).toBeDefined();
    expect(update[1]).toEqual([true, roomId]);
  });

  it('unlocks the room with a valid admin token (admin token works while locked)', async () => {
    lockRoom(true);
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE rooms SET locked
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${roomId}/lock`,
      headers: { authorization: `Bearer ${signAdminToken()}` },
      payload: { locked: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, locked: false });
  });

  it('returns 400 for a non-boolean locked value', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${roomId}/lock`,
      headers: { authorization: `Bearer ${signAdminToken()}` },
      payload: { locked: 'yes' },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Locked-room enforcement over HTTP
// ---------------------------------------------------------------------------
describe('Locked room — HTTP mutations are read-only for non-admin tokens', () => {
  it('blocks POST /api/rooms/:id/chains with 403 "Room is locked"', async () => {
    lockRoom();
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/chains`,
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceZoneId: VALID_ZONE_A },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: string }>().error).toMatch(/locked/i);
    // The route body must never run.
    expect(mockDb.query).not.toHaveBeenCalled();
  });

  it('blocks POST /api/rooms/:id/connections with 403', async () => {
    lockRoom();
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { fromZoneId: 'qiient-al-nusom', toZoneId: 'qiient-al-odesum', secondsRemaining: 1800, slots: 7 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: string }>().error).toMatch(/locked/i);
  });

  it('blocks DELETE /api/rooms/:id/connections (reset) with 403', async () => {
    lockRoom();
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('blocks PUT /api/rooms/:id/import with 403', async () => {
    lockRoom();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/rooms/${roomId}/import`,
      headers: { authorization: `Bearer ${token}` },
      payload: { homeZoneId: VALID_ZONE_A, connections: [], nodePositions: [] },
    });
    expect(res.statusCode).toBe(403);
  });

  it('still allows GET /api/rooms/:id/connections (reads) for non-admin tokens', async () => {
    lockRoom();
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections
    const res = await app.inject({
      method: 'GET',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('allows mutations for admin tokens while locked', async () => {
    lockRoom();
    // POST /chains happy-path mocks
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room exists
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // existing node check
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/chains`,
      headers: { authorization: `Bearer ${signAdminToken()}` },
      payload: { sourceZoneId: VALID_ZONE_A },
    });
    expect(res.statusCode).toBe(201);
  });

  it('allows mutations for regular tokens when the room is unlocked', async () => {
    lockRoom(false);
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room exists
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // existing node check
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/chains`,
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceZoneId: VALID_ZONE_A },
    });
    expect(res.statusCode).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Locked-room enforcement over WebSocket
// ---------------------------------------------------------------------------
describe('Locked room — WebSocket', () => {
  function mockWsAuthSync(locked = false) {
    mockDb.query.mockResolvedValueOnce({
      rows: [{
        id: roomId,
        title: null,
        password_hash: roomPasswordHash,
        admin_password_hash: adminPasswordHash,
        home_zone_id: VALID_ZONE_A,
        created_at: new Date().toISOString(),
        updated_at: null,
        chain_migrated: true,
        locked,
      }],
    }); // SELECT * FROM rooms
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: 'test-chain-id', source_zone_id: VALID_ZONE_A }] }); // chains
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // node positions
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // memory
  }

  async function connectAndAuth(authToken: string): Promise<{ socket: import('ws').WebSocket; sync: any }> {
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 3001;
    const { WebSocket } = await import('ws');
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/rooms/${roomId}`);
    await new Promise<void>((resolve, reject) => {
      socket.on('open', resolve);
      socket.on('error', reject);
    });
    const messages: any[] = [];
    const synced = new Promise<any>((resolve) => {
      socket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        messages.push(msg);
        if (msg.type === 'sync') resolve(msg);
      });
    });
    socket.send(JSON.stringify({ type: 'auth', token: authToken }));
    const sync = await synced;
    return { socket, sync };
  }

  function nextMessage(socket: import('ws').WebSocket, type?: string): Promise<any> {
    return new Promise((resolve) => {
      const handler = (data: any) => {
        const msg = JSON.parse(data.toString());
        if (!type || msg.type === type) {
          socket.off('message', handler);
          resolve(msg);
        }
      };
      socket.on('message', handler);
    });
  }

  it('sync reports locked state and leaks no password hashes', async () => {
    mockWsAuthSync(true);
    await app.listen({ port: 0 });
    const { socket, sync } = await connectAndAuth(token);

    expect(sync.locked).toBe(true);
    const raw = JSON.stringify(sync);
    expect(raw).not.toContain(roomPasswordHash);
    expect(raw).not.toContain(adminPasswordHash);
    expect(raw).not.toContain('password_hash');

    socket.close();
  });

  it('rejects a mutation from a non-admin socket with "Room is locked" and keeps the socket open', async () => {
    mockWsAuthSync(true);
    lockRoom(true);
    await app.listen({ port: 0 });
    const { socket } = await connectAndAuth(token);

    const errPromise = nextMessage(socket, 'error');
    socket.send(JSON.stringify({ type: 'update_plot_route', plottedRoute: ['a', 'b'] }));
    const err = await errPromise;
    expect(err.message).toMatch(/locked/i);

    // Read-only viewers stay connected.
    expect(socket.readyState).toBe(socket.OPEN);
    // No DB write happened.
    const update = mockDb.query.mock.calls.find((c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE rooms SET plotted_route'));
    expect(update).toBeUndefined();

    socket.close();
  });

  it('allows a mutation from an admin socket while locked', async () => {
    mockWsAuthSync(true);
    lockRoom(true);
    await app.listen({ port: 0 });
    const { socket } = await connectAndAuth(signAdminToken());

    socket.send(JSON.stringify({ type: 'update_plot_route', plottedRoute: ['a', 'b'] }));
    await vi.waitFor(() => {
      const update = mockDb.query.mock.calls.find((c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE rooms SET plotted_route'));
      expect(update).toBeDefined();
    });

    socket.close();
  });

  it('a locked session cannot piggyback an admin token from another room', async () => {
    mockWsAuthSync(true);
    await app.listen({ port: 0 });

    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 3001;
    const { WebSocket } = await import('ws');
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/rooms/${roomId}`);
    await new Promise<void>((resolve) => { socket.on('open', () => resolve()); });

    const closeCode = await new Promise<number>((resolve) => {
      socket.on('close', (code) => resolve(code));
      socket.send(JSON.stringify({ type: 'auth', token: signAdminToken('some-other-room') }));
    });
    expect(closeCode).toBe(4401);
  });

  it('broadcasts room_lock_changed to connected viewers when an admin locks the room', async () => {
    mockWsAuthSync(false);
    await app.listen({ port: 0 });
    const { socket: viewer } = await connectAndAuth(token);

    const lockMsgPromise = nextMessage(viewer, 'room_lock_changed');
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE rooms SET locked
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${roomId}/lock`,
      headers: { authorization: `Bearer ${signAdminToken()}` },
      payload: { locked: true },
    });
    expect(res.statusCode).toBe(200);

    const lockMsg = await lockMsgPromise;
    expect(lockMsg).toEqual({ type: 'room_lock_changed', locked: true });

    viewer.close();
  });
});
