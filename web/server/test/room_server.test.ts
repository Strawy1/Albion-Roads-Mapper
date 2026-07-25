import { describe, it, expect } from 'vitest';
import bcrypt from 'bcrypt';
import { setupTestApp } from './testApp.js';

const VALID_ZONE_ID = 'qiient-al-nusom';

const ctx = setupTestApp();

/** The room row read by PATCH /server before it decides whether admin auth is needed. */
function roomRow(server: string | null, adminPasswordHash: string) {
  return { rows: [{ server, admin_password_hash: adminPasswordHash }], rowCount: 1 };
}

describe('POST /api/rooms — server assignment at creation', () => {
  it('persists the chosen server', async () => {
    const res = await ctx.app!.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: {
        password: 'password',
        adminPassword: 'admin',
        homeZoneId: VALID_ZONE_ID,
        server: 'us',
        vanityUrl: 'test-room',
      },
    });

    expect(res.statusCode).toBe(201);
    const client = await ctx.mockDb.connect.mock.results[0].value;
    const roomInsert = client.query.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO rooms')
    );
    expect(roomInsert[0]).toContain('server');
    expect(roomInsert[1]).toContain('us');
  });

  it('still creates the room when no server is sent, leaving it unassigned', async () => {
    const res = await ctx.app!.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: {
        password: 'password',
        adminPassword: 'admin',
        homeZoneId: VALID_ZONE_ID,
        vanityUrl: 'legacy-client-room',
      },
    });

    expect(res.statusCode).toBe(201);
    const client = await ctx.mockDb.connect.mock.results[0].value;
    const roomInsert = client.query.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO rooms')
    );
    expect(roomInsert[1][5]).toBeNull();
  });

  it('rejects an unknown server value', async () => {
    const res = await ctx.app!.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: {
        password: 'password',
        adminPassword: 'admin',
        homeZoneId: VALID_ZONE_ID,
        server: 'oceania',
        vanityUrl: 'test-room',
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /api/rooms/:id/server', () => {
  it('returns 401 with no token', async () => {
    const res = await ctx.app!.inject({
      method: 'PATCH',
      url: `/api/rooms/${ctx.roomId}/server`,
      payload: { server: 'eu' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when the token is for a different room', async () => {
    const token = ctx.app!.jwt.sign({ roomId: 'other-room' });
    const res = await ctx.app!.inject({
      method: 'PATCH',
      url: `/api/rooms/${ctx.roomId}/server`,
      headers: { authorization: `Bearer ${token}` },
      payload: { server: 'eu' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 for an unknown server value', async () => {
    const res = await ctx.app!.inject({
      method: 'PATCH',
      url: `/api/rooms/${ctx.roomId}/server`,
      headers: { authorization: `Bearer ${ctx.token}` },
      payload: { server: 'oceania' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when the room is missing', async () => {
    ctx.mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await ctx.app!.inject({
      method: 'PATCH',
      url: `/api/rooms/${ctx.roomId}/server`,
      headers: { authorization: `Bearer ${ctx.token}` },
      payload: { server: 'eu' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('assigns an unassigned room without an admin password', async () => {
    const adminHash = await bcrypt.hash('admin', 4);
    ctx.mockDb.query
      .mockResolvedValueOnce(roomRow(null, adminHash))            // SELECT server, admin_password_hash
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });           // UPDATE rooms SET server

    const res = await ctx.app!.inject({
      method: 'PATCH',
      url: `/api/rooms/${ctx.roomId}/server`,
      headers: { authorization: `Bearer ${ctx.token}` },
      payload: { server: 'asia' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toMatchObject({ ok: true, server: 'asia' });
    const update = ctx.mockDb.query.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('UPDATE rooms SET server')
    );
    expect(update[1]).toEqual(['asia', ctx.roomId]);
  });

  it('rejects a change without an admin password once a server is recorded', async () => {
    const adminHash = await bcrypt.hash('admin', 4);
    ctx.mockDb.query.mockResolvedValueOnce(roomRow('eu', adminHash));

    const res = await ctx.app!.inject({
      method: 'PATCH',
      url: `/api/rooms/${ctx.roomId}/server`,
      headers: { authorization: `Bearer ${ctx.token}` },
      payload: { server: 'us' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error).toContain('Admin password');
    expect(
      ctx.mockDb.query.mock.calls.some(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('UPDATE rooms SET server')
      )
    ).toBe(false);
  });

  it('rejects a change with the wrong admin password', async () => {
    const adminHash = await bcrypt.hash('correct-admin', 4);
    ctx.mockDb.query.mockResolvedValueOnce(roomRow('eu', adminHash));

    const res = await ctx.app!.inject({
      method: 'PATCH',
      url: `/api/rooms/${ctx.roomId}/server`,
      headers: { authorization: `Bearer ${ctx.token}` },
      payload: { server: 'us', adminPassword: 'wrong-admin' },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.payload).error).toBe('Invalid admin password');
  });

  it('changes the server with the correct admin password', async () => {
    const adminHash = await bcrypt.hash('correct-admin', 4);
    ctx.mockDb.query
      .mockResolvedValueOnce(roomRow('eu', adminHash))
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await ctx.app!.inject({
      method: 'PATCH',
      url: `/api/rooms/${ctx.roomId}/server`,
      headers: { authorization: `Bearer ${ctx.token}` },
      payload: { server: 'us', adminPassword: 'correct-admin' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toMatchObject({ ok: true, server: 'us' });
  });

  it('treats re-sending the current server as a no-op that needs no admin password', async () => {
    const adminHash = await bcrypt.hash('admin', 4);
    ctx.mockDb.query
      .mockResolvedValueOnce(roomRow('eu', adminHash))
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await ctx.app!.inject({
      method: 'PATCH',
      url: `/api/rooms/${ctx.roomId}/server`,
      headers: { authorization: `Bearer ${ctx.token}` },
      payload: { server: 'eu' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toMatchObject({ ok: true, server: 'eu' });
  });

  it('is blocked by the room lock for non-admin tokens', async () => {
    // The authenticate preHandler's room guard rejects mutating requests in a
    // locked room before the route ever runs.
    ctx.guardRows = [{ locked: true, password_version: 1 }];

    const res = await ctx.app!.inject({
      method: 'PATCH',
      url: `/api/rooms/${ctx.roomId}/server`,
      headers: { authorization: `Bearer ${ctx.token}` },
      payload: { server: 'eu' },
    });

    expect(res.statusCode).toBe(403);
  });
});
