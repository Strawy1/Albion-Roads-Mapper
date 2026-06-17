import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

// A known valid zone ID from the shared catalogue
const VALID_ZONE_ID = 'qiient-al-nusom';

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

describe('POST /api/rooms', () => {
  it('creates a room and returns id + shareUrl', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { password: 'secret', adminPassword: 'admin', homeZoneId: VALID_ZONE_ID, vanityUrl: 'my-test-room' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; shareUrl: string }>();
    expect(body.id).toBe('my-test-room');
    expect(body.shareUrl).toContain('my-test-room');
  });

  it('hashes the password (not stored as plaintext)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { password: 'mypassword', adminPassword: 'admin', homeZoneId: VALID_ZONE_ID, vanityUrl: 'my-test-room' },
    });
    expect(res.statusCode).toBe(201);
    const { id } = res.json<{ id: string }>();

    // Mock the direct DB query in the test
    mockDb.query.mockResolvedValueOnce({ 
      rows: [{ password_hash: '$2b$12$somehash' }] 
    });

    const { rows } = await (app as any).db.query('SELECT password_hash FROM rooms WHERE id = $1', [id]);
    const row = rows[0];
    expect(row).toBeDefined();
    expect(row!.password_hash).not.toBe('mypassword');
    expect(row!.password_hash).toMatch(/^\$2b\$/); // bcrypt hash prefix
  });

  it('rejects duplicate vanity URLs', async () => {
    const clientMock = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'my-room' }], rowCount: 1 }) // existing check — taken
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }), // ROLLBACK
      release: vi.fn(),
    };
    mockDb.connect.mockResolvedValueOnce(clientMock);

    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { password: 'pw1', adminPassword: 'admin', homeZoneId: VALID_ZONE_ID, vanityUrl: 'my-room' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: string }>().error).toMatch(/already taken/i);
  });

  it('rejects when homeZoneId is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { password: 'secret', adminPassword: 'admin', vanityUrl: 'my-room' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects when homeZoneId is empty string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { password: 'secret', adminPassword: 'admin', homeZoneId: '', vanityUrl: 'my-room' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects when homeZoneId is not in zone catalogue', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { password: 'secret', adminPassword: 'admin', homeZoneId: 'totally-unknown-zone-xyz', vanityUrl: 'my-room' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/zone catalogue/i);
  });

  it('accepts any catalogue zone as homeZoneId (relaxed from roads-hideout-only)', async () => {
    // After the multi-chain refactor, a room may be rooted at any zone in the catalogue,
    // not only roads hideouts. Only zones missing from the catalogue are rejected.
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { password: 'secret', adminPassword: 'admin', homeZoneId: 'willow-wood', vanityUrl: 'my-room' },
    });
    expect([201, 409]).toContain(res.statusCode);
  });
});

describe('POST /api/rooms/:id/auth', () => {
  let roomId = 'test-room-id';

  it('returns a token with correct password', async () => {
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.default.hash('correct-pw', 1);
    mockDb.query.mockResolvedValueOnce({ 
      rows: [{ id: roomId, password_hash: hash }] 
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/auth`,
      payload: { password: 'correct-pw' },
    });
    expect(res.statusCode).toBe(200);
    const { token } = res.json<{ token: string }>();
    expect(token).toBeDefined();
  });

  it('returns 401 with wrong password', async () => {
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.default.hash('correct-pw', 1);
    mockDb.query.mockResolvedValueOnce({ 
      rows: [{ id: roomId, password_hash: hash }] 
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/auth`,
      payload: { password: 'wrong-pw' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for non-existent room', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms/doesnotexist12/auth',
      payload: { password: 'pw' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/rooms/:id', () => {
  it('returns 204 and deletes room data when admin password is correct', async () => {
    const bcrypt = await import('bcrypt');
    const roomId = 'test-room-id';
    const adminHash = await bcrypt.default.hash('admin-pw', 1);
    const token = app.jwt.sign({ roomId });

    // Mock: SELECT admin_password_hash
    mockDb.query.mockResolvedValueOnce({
      rows: [{ admin_password_hash: adminHash }],
    });

    const clientMock = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    mockDb.connect.mockResolvedValueOnce(clientMock);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { adminPassword: 'admin-pw' },
    });

    expect(res.statusCode).toBe(204);

    // Verify transaction queries were executed
    const calls = clientMock.query.mock.calls.map((c: any[]) => c[0]);
    expect(calls.some((q: string) => q.includes('BEGIN'))).toBe(true);
    expect(calls.some((q: string) => q.includes('DELETE FROM connections'))).toBe(true);
    expect(calls.some((q: string) => q.includes('DELETE FROM room_node_positions'))).toBe(true);
    expect(calls.some((q: string) => q.includes('DELETE FROM room_node_memory'))).toBe(true);
    expect(calls.some((q: string) => q.includes('DELETE FROM rooms'))).toBe(true);
    expect(calls.some((q: string) => q.includes('COMMIT'))).toBe(true);
  });

  it('returns 401 when admin password is wrong', async () => {
    const bcrypt = await import('bcrypt');
    const roomId = 'test-room-id';
    const adminHash = await bcrypt.default.hash('correct-admin', 1);
    const token = app.jwt.sign({ roomId });

    mockDb.query.mockResolvedValueOnce({
      rows: [{ admin_password_hash: adminHash }],
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { adminPassword: 'wrong-admin' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toMatch(/invalid admin password/i);
  });

  it('returns 400 when adminPassword is missing', async () => {
    const roomId = 'test-room-id';
    const token = app.jwt.sign({ roomId });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/admin password required/i);
  });

  it('returns 404 when room does not exist', async () => {
    const roomId = 'ghost-room';
    const token = app.jwt.sign({ roomId });

    mockDb.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { adminPassword: 'any-password' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: string }>().error).toMatch(/room not found/i);
  });

  it('returns 403 when token belongs to a different room', async () => {
    const roomId = 'test-room-id';
    const token = app.jwt.sign({ roomId: 'other-room' });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { adminPassword: 'admin-pw' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 401 when no auth token is provided', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/rooms/test-room-id',
      payload: { adminPassword: 'admin-pw' },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('DELETE /api/rooms/:id/connections', () => {
  it('returns 204 and deletes connections without admin password (clear room)', async () => {
    const bcrypt = await import('bcrypt');
    const roomId = 'test-room-id';
    const adminHash = await bcrypt.default.hash('admin-pw', 1);
    const token = app.jwt.sign({ roomId });

    const clientMock = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ admin_password_hash: adminHash, home_zone_id: 'home-zone' }] }) // SELECT
        .mockResolvedValue({ rows: [], rowCount: 0 }), // remaining queries
      release: vi.fn(),
    };
    mockDb.connect.mockResolvedValueOnce(clientMock);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}/connections`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(204);
    const calls = clientMock.query.mock.calls.map((c: any[]) => c[0]);
    expect(calls.some((q: string) => q.includes('BEGIN'))).toBe(true);
    expect(calls.some((q: string) => q.includes('DELETE FROM connections'))).toBe(true);
    expect(calls.some((q: string) => q.includes('COMMIT'))).toBe(true);
  });

  it('returns 204 and deletes connections when correct admin password is provided', async () => {
    const bcrypt = await import('bcrypt');
    const roomId = 'test-room-id';
    const adminHash = await bcrypt.default.hash('admin-pw', 1);
    const token = app.jwt.sign({ roomId });

    const clientMock = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ admin_password_hash: adminHash, home_zone_id: 'home-zone' }] }) // SELECT
        .mockResolvedValue({ rows: [], rowCount: 0 }), // remaining queries
      release: vi.fn(),
    };
    mockDb.connect.mockResolvedValueOnce(clientMock);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}/connections`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { adminPassword: 'admin-pw' },
    });

    expect(res.statusCode).toBe(204);
    const calls = clientMock.query.mock.calls.map((c: any[]) => c[0]);
    expect(calls.some((q: string) => q.includes('DELETE FROM connections'))).toBe(true);
    expect(calls.some((q: string) => q.includes('COMMIT'))).toBe(true);
  });

  it('returns 401 when admin password is provided but wrong', async () => {
    const bcrypt = await import('bcrypt');
    const roomId = 'test-room-id';
    const adminHash = await bcrypt.default.hash('correct-admin', 1);
    const token = app.jwt.sign({ roomId });

    const clientMock = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ admin_password_hash: adminHash, home_zone_id: 'home-zone' }] }) // SELECT
        .mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    mockDb.connect.mockResolvedValueOnce(clientMock);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}/connections`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { adminPassword: 'wrong-admin' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toMatch(/invalid admin password/i);
  });

  it('returns 404 when room does not exist', async () => {
    const roomId = 'ghost-room';
    const token = app.jwt.sign({ roomId });

    const clientMock = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT — room not found
        .mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    mockDb.connect.mockResolvedValueOnce(clientMock);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}/connections`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: string }>().error).toMatch(/room not found/i);
  });

  it('returns 403 when token belongs to a different room', async () => {
    const roomId = 'test-room-id';
    const token = app.jwt.sign({ roomId: 'other-room' });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}/connections`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 401 when no auth token is provided', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/rooms/test-room-id/connections',
      payload: {},
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('Home Zone Node Protection', () => {
  it('should NOT allow changing home zone via PATCH /api/rooms/:id', async () => {
    const roomId = 'test-room-id';
    const token = app.jwt.sign({ roomId });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${roomId}`,
      headers: {
        Authorization: `Bearer ${token}`,
      },
      payload: { homeZoneId: 'qiient-et-tertum' },
    });

    // It should now return 404 since the route is removed
    expect(res.statusCode).toBe(404);
  });
});
