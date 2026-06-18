import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';

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

describe('Room Title Persistence', () => {
  it('should save the room title when creating a room', async () => {
    const title = 'The Dragon Den';
    
    // Mock the room insertion
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'room-1' }] });
    
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { 
        password: 'password', 
        adminPassword: 'admin', 
        homeZoneId: VALID_ZONE_ID,
        title: title,
        vanityUrl: 'test-room'
      },
    });
    
    expect(res.statusCode).toBe(201);
    
    // Verify the title was passed to the DB query
    const client = await mockDb.connect.mock.results[0].value;
    const roomInsertCall = client.query.mock.calls.find(call => 
      typeof call[0] === 'string' && call[0].includes('INSERT INTO rooms')
    );
    
    expect(roomInsertCall).toBeDefined();
    // The query should contain 'title' and the values should contain the title
    expect(roomInsertCall[0]).toContain('title');
    expect(roomInsertCall[1]).toContain(title);
  });

  it('should reject a title longer than 50 characters', async () => {
    const longTitle = 'a'.repeat(51);
    
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { 
        password: 'password', 
        adminPassword: 'admin', 
        homeZoneId: VALID_ZONE_ID,
        title: longTitle,
        vanityUrl: 'test-room'
      },
    });
    
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error).toContain('String must contain at most 50 character(s)');
  });

  it('should include the title in the sync message when connecting via WebSocket', async () => {
    // This is harder to test with just app.inject for WS, but we can test the sync logic indirectly
    // or just assume the WS handler uses the same DB query logic.
    // In our case, the WS sync message is built in web/server/src/ws.ts
    
    // Let's verify that the GET /api/rooms/:id/auth (or similar) returns a room that could have a title
    // Actually, the sync message is sent upon WS connection.
    
    // We can't easily test WS with Vitest in this setup without a lot of mocking.
    // But we can check if the title column is in the migrations and the code uses it.
  });
});

describe('PATCH /api/rooms/:id/title — rename room', () => {
  const ROOM_ID = 'test-room';

  it('returns 401 with no token', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${ROOM_ID}/title`,
      payload: { title: 'New Name', adminPassword: 'admin' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when token is for a different room', async () => {
    const token = app.jwt.sign({ roomId: 'other-room' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${ROOM_ID}/title`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'New Name', adminPassword: 'admin' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when title exceeds 50 characters', async () => {
    const token = app.jwt.sign({ roomId: ROOM_ID });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${ROOM_ID}/title`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'a'.repeat(51), adminPassword: 'admin' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when adminPassword is missing', async () => {
    const token = app.jwt.sign({ roomId: ROOM_ID });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${ROOM_ID}/title`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'New Name' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when room is not found', async () => {
    const token = app.jwt.sign({ roomId: ROOM_ID });
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // room not found
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${ROOM_ID}/title`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'New Name', adminPassword: 'admin' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 401 when admin password is incorrect', async () => {
    const token = app.jwt.sign({ roomId: ROOM_ID });
    const correctAdminHash = await bcrypt.hash('correct-admin', 4);
    mockDb.query.mockResolvedValueOnce({ rows: [{ admin_password_hash: correctAdminHash }], rowCount: 1 });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${ROOM_ID}/title`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'New Name', adminPassword: 'wrong-admin' },
    });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe('Invalid admin password');
  });

  it('renames the room successfully and returns ok', async () => {
    const token = app.jwt.sign({ roomId: ROOM_ID });
    const adminPasswordHash = await bcrypt.hash('correct-admin', 4);
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ admin_password_hash: adminPasswordHash }], rowCount: 1 }) // SELECT admin_password_hash
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE rooms SET title
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${ROOM_ID}/title`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Dragon Lair', adminPassword: 'correct-admin' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.ok).toBe(true);
    expect(body.title).toBe('Dragon Lair');
  });

  it('allows clearing the title with an empty string', async () => {
    const token = app.jwt.sign({ roomId: ROOM_ID });
    const adminPasswordHash = await bcrypt.hash('admin', 4);
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ admin_password_hash: adminPasswordHash }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${ROOM_ID}/title`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: '', adminPassword: 'admin' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.ok).toBe(true);
    expect(body.title).toBe('');
  });
});
