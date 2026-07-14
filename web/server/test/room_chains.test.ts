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
      rows: [{ zone_id: OTHER_ROADS_ZONE, x: 0, y: 0, features: {}, custom_handles: null, rotation: 0, explored: false, chain_id: null }],
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

  // Regression: the freshly created chain's source zone must carry the new
  // chain's id in the `node_positions_updated` broadcast so clients can
  // resolve the friendly id / colour pill immediately (no page refresh).
  it('broadcasts node_positions_updated with the new chainId on the source zone', async () => {
    const token = app.jwt.sign({ roomId: ROOM_ID, passwordVersion: 1 });

    // 1. password version check
    mockDb.query.mockResolvedValueOnce({ rows: [{ password_version: 1 }], rowCount: 1 });
    // 2. room existence lookup
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: ROOM_ID }], rowCount: 1 });
    // 3. duplicate-root lookup: no existing row (so the source node will be inserted)
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // 4. (after transaction) re-fetch node positions for broadcast — the new
    //    source zone row carries the new chain's id.
    mockDb.query.mockImplementationOnce(async (sql: string) => {
      // Echo back the chain_id that the route just stored — vitest captures the
      // INSERT params on the tx client; for simplicity we just hard-code that
      // the broadcast SELECT returns whatever chain id the broadcast emitted.
      return {
        rows: [{
          zone_id: OTHER_ROADS_ZONE,
          x: 0,
          y: 0,
          features: {},
          custom_handles: null,
          rotation: 0,
          explored: false,
          chain_id: 'NEW_CHAIN_PLACEHOLDER',
        }],
        rowCount: 1,
      };
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
    const newChainId = body.chain.id;
    expect(newChainId).toBeTruthy();

    const npuCall = broadcastMock.mock.calls.find(
      (call: any[]) => call[0] === ROOM_ID && call[1]?.type === 'node_positions_updated'
    );
    expect(npuCall).toBeDefined();
    const payload = npuCall![1] as any;
    const sourceEntry = payload.nodePositions.find((p: any) => p.zoneId === OTHER_ROADS_ZONE);
    expect(sourceEntry).toBeDefined();
    // The broadcast must surface chainId for the new source zone so clients can
    // assign the correct chain pill immediately on receipt.
    expect(sourceEntry.chainId).toBeDefined();
    expect(sourceEntry.chainId).toBe('NEW_CHAIN_PLACEHOLDER');
  });

  // Regression: adding a new chain MUST NOT move any preexisting nodes. The
  // broadcast that announces the new source zone must contain ONLY that single
  // row — re-broadcasting all positions would risk clobbering other clients'
  // authoritative state for nodes belonging to existing chains.
  it('does not include preexisting nodes in the post-add node_positions_updated broadcast', async () => {
    const token = app.jwt.sign({ roomId: ROOM_ID, passwordVersion: 1 });

    // 1. password version check
    mockDb.query.mockResolvedValueOnce({ rows: [{ password_version: 1 }], rowCount: 1 });
    // 2. room existence lookup
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: ROOM_ID }], rowCount: 1 });
    // 3. duplicate-root lookup: no existing row
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // 4. (after transaction) re-fetch node positions for broadcast — assert
    //    the SELECT is scoped to the new source zone only (room_id + zone_id),
    //    so even if the DB held many preexisting rows, only the new node would
    //    be returned and broadcast.
    let capturedSql = '';
    let capturedParams: unknown[] | undefined;
    mockDb.query.mockImplementationOnce(async (sql: string, params: unknown[]) => {
      capturedSql = sql;
      capturedParams = params;
      return {
        rows: [{
          zone_id: OTHER_ROADS_ZONE,
          x: 0,
          y: 0,
          features: {},
          custom_handles: null,
          rotation: 0,
          explored: false,
          chain_id: 'NEW_CHAIN_ID',
        }],
        rowCount: 1,
      };
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

    // The broadcast SELECT must be scoped to the single new source zone.
    expect(capturedSql).toContain('zone_id = $2');
    expect(capturedParams).toEqual([ROOM_ID, OTHER_ROADS_ZONE]);

    const npuCall = broadcastMock.mock.calls.find(
      (call: any[]) => call[0] === ROOM_ID && call[1]?.type === 'node_positions_updated'
    );
    expect(npuCall).toBeDefined();
    const payload = npuCall![1] as any;
    // Only the freshly inserted source node should be in the broadcast — no
    // preexisting node positions piggy-back along to potentially overwrite
    // other clients' state.
    expect(payload.nodePositions).toHaveLength(1);
    expect(payload.nodePositions[0].zoneId).toBe(OTHER_ROADS_ZONE);
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

    // Map history must survive a chain deletion — room_node_memory is only
    // ever deleted via the explicit memory endpoints.
    const memoryDeleteCalls = txClient.query.mock.calls.filter(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('DELETE FROM room_node_memory')
    );
    expect(memoryDeleteCalls).toHaveLength(0);
  });
});

describe('POST /api/rooms/:id/chains/:chainId/relocate', () => {
  const NEW_SOURCE_ZONE = ZONE_ID; // any valid catalogue zone different from the current source
  const OLD_SOURCE = OTHER_ROADS_ZONE;
  const ORPHAN_ZONE = 'some-other-zone'; // a zone connected to the chain but whose chain_id is NULL

  it('wipes the chain (including zones with NULL chain_id reachable via connections) and broadcasts chain_relocated', async () => {
    const token = app.jwt.sign({ roomId: ROOM_ID, passwordVersion: 1 });

    // 1. password version check
    mockDb.query.mockResolvedValueOnce({ rows: [{ password_version: 1 }], rowCount: 1 });
    // 2. room lookup
    mockDb.query.mockResolvedValueOnce({ rows: [{ home_zone_id: ZONE_ID }], rowCount: 1 });
    // 3. chain lookup
    mockDb.query.mockResolvedValueOnce({
      rows: [{ id: 'chain-to-relocate', source_zone_id: OLD_SOURCE, chain_number: 2, chain_color: '#3b82f6' }],
      rowCount: 1,
    });
    // 4. existingNode lookup for the *new* source: not yet in any chain
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const txClient = {
      query: vi.fn()
        // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // SELECT connections — includes a connection to an orphan zone whose
        // chain_id was never set on its room_node_positions row.
        .mockResolvedValueOnce({
          rows: [
            { id: 'conn-a', from_zone_id: OLD_SOURCE, to_zone_id: ORPHAN_ZONE },
          ],
          rowCount: 1,
        })
        // SELECT room_node_positions WHERE chain_id = $2 — only the source is tagged
        .mockResolvedValueOnce({ rows: [{ zone_id: OLD_SOURCE }], rowCount: 1 })
        // SELECT x, y FROM room_node_positions WHERE zone_id = old source (for relocate-in-place)
        .mockResolvedValueOnce({ rows: [{ x: 123, y: -45 }], rowCount: 1 })
        // DELETE connections ... RETURNING id (both the chain-tagged conn and any
        // touching the orphan zone get dropped)
        .mockResolvedValueOnce({ rows: [{ id: 'conn-a' }], rowCount: 1 })
        // DELETE room_node_positions WHERE zone_id = ANY(...)
        .mockResolvedValueOnce({ rows: [], rowCount: 2 })
        // INSERT new source node position
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // INSERT room_node_memory ON CONFLICT
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // UPDATE room_chains SET source_zone_id
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
      method: 'POST',
      url: `/api/rooms/${ROOM_ID}/chains/chain-to-relocate/relocate`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { sourceZoneId: NEW_SOURCE_ZONE },
    });

    expect(res.statusCode).toBe(200);

    // Find the DELETE FROM connections call — the SQL should also key off zone
    // membership, otherwise orphan rows with chain_id NULL would survive.
    const deleteConnCall = txClient.query.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string'
        && /DELETE FROM connections/i.test(call[0])
        && /from_zone_id = ANY|to_zone_id = ANY/i.test(call[0])
    );
    expect(deleteConnCall, 'relocate should delete connections by both chain_id AND zone membership').toBeDefined();
    // The zone-id list passed to the DELETE must include the orphan zone.
    const zoneIdsArg = deleteConnCall![1][2] as string[] | null;
    expect(zoneIdsArg).toBeTruthy();
    expect(zoneIdsArg).toContain(ORPHAN_ZONE);
    expect(zoneIdsArg).toContain(OLD_SOURCE);
    expect(zoneIdsArg).not.toContain(NEW_SOURCE_ZONE);

    // The DELETE FROM room_node_positions must be the zone-ANY variant (not the
    // chain_id-only variant which would leave the orphan position behind).
    const deletePosCall = txClient.query.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string'
        && /DELETE FROM room_node_positions/i.test(call[0])
        && /zone_id = ANY/i.test(call[0])
    );
    expect(deletePosCall, 'relocate should delete node positions by zone-id list').toBeDefined();

    const chainRelocatedCall = broadcastMock.mock.calls.find(
      (call: any[]) => call[0] === ROOM_ID && call[1]?.type === 'chain_relocated'
    );
    expect(chainRelocatedCall).toBeDefined();
    const payload = chainRelocatedCall![1] as any;
    expect(payload.chain.sourceZoneId).toBe(NEW_SOURCE_ZONE);
    // The new source must be placed at the old source's position, not (0,0).
    expect(payload.newSourceNodePosition.x).toBe(123);
    expect(payload.newSourceNodePosition.y).toBe(-45);
    expect(payload.removedZoneIds).toContain(ORPHAN_ZONE);
    expect(payload.removedZoneIds).toContain(OLD_SOURCE);
    expect(payload.removedZoneIds).not.toContain(NEW_SOURCE_ZONE);
    expect(payload.removedConnectionIds).toContain('conn-a');

    // Map history must survive a chain relocation — room_node_memory is only
    // ever deleted via the explicit memory endpoints.
    const memoryDeleteCalls = txClient.query.mock.calls.filter(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('DELETE FROM room_node_memory')
    );
    expect(memoryDeleteCalls).toHaveLength(0);
  });
});
