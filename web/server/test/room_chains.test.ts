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

const ROOM_ID = 'test-room-id';
const ZONE_ID = 'qiient-al-nusom'; // a known hideout zone
const OTHER_ROADS_ZONE = 'adrens-hill'; // any catalogue zone — validation only checks existence

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

describe('POST /api/rooms/:id/chains', () => {
  it('rejects requests without a matching JWT roomId', async () => {
    const token = app.jwt.sign({ roomId: 'other-room', passwordVersion: 1 });

    // password version check passes for the unrelated room
    mockDb.query.mockResolvedValueOnce({ rows: [{ password_version: 1 }], rowCount: 1 });

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${ROOM_ID}/chains`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { sourceZoneId: ZONE_ID },
    });

    expect(res.statusCode).toBe(403);
  });

  it('rejects an unknown zone id', async () => {
    const token = app.jwt.sign({ roomId: ROOM_ID, passwordVersion: 1 });
    mockDb.query.mockResolvedValueOnce({ rows: [{ password_version: 1 }], rowCount: 1 });

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${ROOM_ID}/chains`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { sourceZoneId: 'not-a-real-zone' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/sourceZoneId/);
  });

  it('returns 404 when the room does not exist', async () => {
    const token = app.jwt.sign({ roomId: ROOM_ID, passwordVersion: 1 });

    // 1. password version check
    mockDb.query.mockResolvedValueOnce({ rows: [{ password_version: 1 }], rowCount: 1 });
    // 2. room existence lookup: empty
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${ROOM_ID}/chains`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { sourceZoneId: ZONE_ID },
    });

    expect(res.statusCode).toBe(404);
  });

  it('rejects an already-chained source zone (duplicate root)', async () => {
    const token = app.jwt.sign({ roomId: ROOM_ID, passwordVersion: 1 });

    mockDb.query.mockResolvedValueOnce({ rows: [{ password_version: 1 }], rowCount: 1 });
    // room existence lookup
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: ROOM_ID }], rowCount: 1 });
    // existing room_node_positions row with a chain_id
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'existing-chain-id' }], rowCount: 1 });

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${ROOM_ID}/chains`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { sourceZoneId: ZONE_ID },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: string }>().error).toMatch(/existing chain/i);
  });

  it('creates a chain and broadcasts chain_added', async () => {
    const token = app.jwt.sign({ roomId: ROOM_ID, passwordVersion: 1 });

    // 1. password version check
    mockDb.query.mockResolvedValueOnce({ rows: [{ password_version: 1 }], rowCount: 1 });
    // 2. room existence lookup
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: ROOM_ID }], rowCount: 1 });
    // 3. duplicate-root lookup: no existing row
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // 4. (after transaction) re-fetch node positions for broadcast
    mockDb.query.mockResolvedValueOnce({
      rows: [{ zone_id: OTHER_ROADS_ZONE, x: 0, y: 0, features: {}, custom_handles: null, rotation: 0, explored: false }],
      rowCount: 1,
    });

    const broadcastMock = vi.mocked(broadcast);
    broadcastMock.mockClear();

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${ROOM_ID}/chains`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { sourceZoneId: OTHER_ROADS_ZONE },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ chain: { id: string; sourceZoneId: string } }>();
    expect(body.chain.sourceZoneId).toBe(OTHER_ROADS_ZONE);
    expect(body.chain.id).toBeTruthy();

    // chain_added must be broadcast for this room
    const chainAddedCall = broadcastMock.mock.calls.find(
      (call: any[]) => call[0] === ROOM_ID && call[1]?.type === 'chain_added'
    );
    expect(chainAddedCall).toBeDefined();
  });
});

describe('DELETE /api/rooms/:id/chains/:chainId', () => {
  it('rejects requests without a matching JWT roomId', async () => {
    const token = app.jwt.sign({ roomId: 'other-room', passwordVersion: 1 });

    mockDb.query.mockResolvedValueOnce({ rows: [{ password_version: 1 }], rowCount: 1 });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM_ID}/chains/some-chain-id`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 404 when the chain does not exist', async () => {
    const token = app.jwt.sign({ roomId: ROOM_ID, passwordVersion: 1 });

    // 1. password version check
    mockDb.query.mockResolvedValueOnce({ rows: [{ password_version: 1 }], rowCount: 1 });
    // 2. room lookup
    mockDb.query.mockResolvedValueOnce({ rows: [{ home_zone_id: ZONE_ID }], rowCount: 1 });
    // 3. chain lookup: empty
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM_ID}/chains/missing-chain`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('refuses to delete the primary chain', async () => {
    const token = app.jwt.sign({ roomId: ROOM_ID, passwordVersion: 1 });

    mockDb.query.mockResolvedValueOnce({ rows: [{ password_version: 1 }], rowCount: 1 });
    mockDb.query.mockResolvedValueOnce({ rows: [{ home_zone_id: ZONE_ID }], rowCount: 1 });
    // chain row whose source_zone_id matches the room's home_zone_id
    mockDb.query.mockResolvedValueOnce({
      rows: [{ id: 'primary-chain-id', source_zone_id: ZONE_ID }],
      rowCount: 1,
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM_ID}/chains/primary-chain-id`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/primary/i);
  });

  it('deletes a non-primary chain and broadcasts chain_removed', async () => {
    const token = app.jwt.sign({ roomId: ROOM_ID, passwordVersion: 1 });

    // 1. password version check
    mockDb.query.mockResolvedValueOnce({ rows: [{ password_version: 1 }], rowCount: 1 });
    // 2. room lookup (home is a *different* zone)
    mockDb.query.mockResolvedValueOnce({ rows: [{ home_zone_id: ZONE_ID }], rowCount: 1 });
    // 3. chain lookup: a non-primary chain rooted at OTHER_ROADS_ZONE
    mockDb.query.mockResolvedValueOnce({
      rows: [{ id: 'chain-to-delete', source_zone_id: OTHER_ROADS_ZONE }],
      rowCount: 1,
    });

    // transaction-internal queries: select connections, select positions, then deletes.
    const txClient = {
      query: vi.fn()
        // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // SELECT connections
        .mockResolvedValueOnce({ rows: [{ id: 'conn-1' }, { id: 'conn-2' }], rowCount: 2 })
        // SELECT room_node_positions
        .mockResolvedValueOnce({ rows: [{ zone_id: OTHER_ROADS_ZONE }, { zone_id: 'some-other-zone' }], rowCount: 2 })
        // DELETE connections
        .mockResolvedValueOnce({ rows: [], rowCount: 2 })
        // DELETE positions
        .mockResolvedValueOnce({ rows: [], rowCount: 2 })
        // DELETE memory
        .mockResolvedValueOnce({ rows: [], rowCount: 2 })
        // DELETE room_chains
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // UPDATE rooms.updated_at
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    mockDb.connect = vi.fn().mockReturnValue(txClient);

    const broadcastMock = vi.mocked(broadcast);
    broadcastMock.mockClear();

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ROOM_ID}/chains/chain-to-delete`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(204);

    const chainRemovedCall = broadcastMock.mock.calls.find(
      (call: any[]) => call[0] === ROOM_ID && call[1]?.type === 'chain_removed'
    );
    expect(chainRemovedCall).toBeDefined();
    const payload = chainRemovedCall![1] as any;
    expect(payload.chainId).toBe('chain-to-delete');
    expect(payload.removedConnectionIds).toEqual(['conn-1', 'conn-2']);
    expect(payload.removedZoneIds).toEqual([OTHER_ROADS_ZONE, 'some-other-zone']);
  });
});
