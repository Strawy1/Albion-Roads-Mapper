import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupTestApp } from './testApp.js';
import type { FastifyInstance } from 'fastify';
import { type Connection, UpdateConnectionBodySchema } from 'shared';
import { broadcast } from '../src/broadcast.js';

vi.mock('../src/broadcast.js', () => ({
  broadcast: vi.fn(),
  addSocket: vi.fn(),
  removeSocket: vi.fn(),
  getTotalSocketCount: vi.fn(() => 0),
}));

const VALID_ZONE_A = 'qiient-al-nusom';
const VALID_ZONE_B = 'qiient-al-odesum';
const UNKNOWN_ZONE = 'totally-unknown-zone-xyz';

const testApp = setupTestApp();
const { roomId } = testApp;
let app: FastifyInstance;
let mockDb: any;
let token: string;

beforeEach(() => {
  ({ app, mockDb, token } = testApp);
});

describe('POST /api/rooms/:id/connections', () => {
  it('creates a connection and returns it', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'test-chain-id' }] }); // fromZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // toZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections check
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT connection
    
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { fromZoneId: VALID_ZONE_A, toZoneId: VALID_ZONE_B, secondsRemaining: 1800, slots: 7 },
    });
    expect(res.statusCode).toBe(201);
    const conn = res.json<Connection>();
    expect(conn.id).toBeDefined();
    expect(conn.fromZoneId).toBe(VALID_ZONE_A);
    expect(conn.toZoneId).toBe(VALID_ZONE_B);
    expect(conn.roomId).toBe(roomId);
    expect(conn.expiresAt).toBeDefined();
    expect(conn.reportedAt).toBeDefined();
  });

  it('rejects same-zone connections', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'test-chain-id' }] }); // fromZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // toZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections check
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { fromZoneId: VALID_ZONE_A, toZoneId: VALID_ZONE_A, secondsRemaining: 1800, slots: 7 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/same-zone/i);
  });

  it('rejects unknown fromZoneId', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'test-chain-id' }] }); // fromZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // toZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections check
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { fromZoneId: UNKNOWN_ZONE, toZoneId: VALID_ZONE_B, secondsRemaining: 1800, slots: 7 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/zone catalogue/i);
  });

  it('rejects unknown toZoneId', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'test-chain-id' }] }); // fromZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // toZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections check
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { fromZoneId: VALID_ZONE_A, toZoneId: UNKNOWN_ZONE, secondsRemaining: 1800, slots: 7 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/zone catalogue/i);
  });

  it('rejects secondsRemaining = 0', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'test-chain-id' }] }); // fromZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // toZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections check
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { fromZoneId: VALID_ZONE_A, toZoneId: VALID_ZONE_B, secondsRemaining: 0, slots: 7 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects secondsRemaining > 86400', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'test-chain-id' }] }); // fromZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // toZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections check
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { fromZoneId: VALID_ZONE_A, toZoneId: VALID_ZONE_B, secondsRemaining: 86401, slots: 7 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a second connection between the same two zones when the source handle is already occupied (same center handle)', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'test-chain-id' }] }); // fromZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // toZoneId chain lookup
    // Existing connection B→A using default center handles; the center handle on VALID_ZONE_A is therefore occupied.
    mockDb.query.mockResolvedValueOnce({ rows: [{ 
      id: 'conn-1', 
      room_id: roomId, 
      from_zone_id: VALID_ZONE_B, 
      to_zone_id: VALID_ZONE_A, 
      from_handle_id: null,   // center on VALID_ZONE_B
      to_handle_id: null,     // center on VALID_ZONE_A — this handle is occupied
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), 
      reported_at: new Date().toISOString(), 
      reported_by: null 
    }] });

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      // Attempt to create A→B with no explicit handles (defaults to center on VALID_ZONE_A — already occupied above)
      payload: { fromZoneId: VALID_ZONE_A, toZoneId: VALID_ZONE_B, secondsRemaining: 1800, slots: 7 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/source handle/i);
  });

  it('rejects connection when source handle is already occupied', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'test-chain-id' }] }); // fromZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // toZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [{
      id: 'conn-existing',
      room_id: roomId,
      from_zone_id: VALID_ZONE_A,
      to_zone_id: 'zone-other',
      from_handle_id: 'handle-1',
      to_handle_id: null,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      reported_at: new Date().toISOString(),
      reported_by: null
    }] }); // connections check — handle-1 on VALID_ZONE_A already occupied

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { fromZoneId: VALID_ZONE_A, toZoneId: VALID_ZONE_B, secondsRemaining: 1800, slots: 7, fromHandleId: 'handle-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/already exists on this source handle/i);
  });

  it('rejects connection when fromHandleId is disabled', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'test-chain-id' }] }); // fromZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // toZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections check
    mockDb.query.mockResolvedValueOnce({ rows: [{ custom_handles: [{ id: 'handle-1', left: '50%', top: '0%', disabled: true }] }] }); // from-zone handles

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { fromZoneId: VALID_ZONE_A, toZoneId: VALID_ZONE_B, secondsRemaining: 1800, slots: 7, fromHandleId: 'handle-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/source handle is disabled/i);
  });

  it('rejects connection when toHandleId is disabled', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'test-chain-id' }] }); // fromZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // toZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections check
    mockDb.query.mockResolvedValueOnce({ rows: [{ custom_handles: [{ id: 'handle-from', left: '50%', top: '0%' }] }] }); // from-zone handles (not disabled)
    mockDb.query.mockResolvedValueOnce({ rows: [{ custom_handles: [{ id: 'handle-2', left: '50%', top: '100%', disabled: true }] }] }); // to-zone handles

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { fromZoneId: VALID_ZONE_A, toZoneId: VALID_ZONE_B, secondsRemaining: 1800, slots: 7, fromHandleId: 'handle-from', toHandleId: 'handle-2' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/destination handle is disabled/i);
  });

  it('instantly creates a connection between two existing nodes using preexisting handle and time details', async () => {
    // Simulates the "replace occupied" flow: no targetPosition, specific handles, secondsRemaining derived from old connection
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'test-chain-id' }] }); // fromZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'test-chain-id' }] }); // toZoneId chain lookup (same chain)
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections check (old ones already deleted)
    mockDb.query.mockResolvedValueOnce({ rows: [{ custom_handles: [{ id: 'handle-src', left: '50%', top: '0%' }] }] }); // from-zone handles
    mockDb.query.mockResolvedValueOnce({ rows: [{ custom_handles: [{ id: 'handle-dst', left: '50%', top: '100%' }] }] }); // to-zone handles
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE source node features
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE target node features
    mockDb.query.mockResolvedValueOnce({ rows: [{ zone_id: VALID_ZONE_B, x: 0, y: 0, features: { slots: 7 }, custom_handles: null }] }); // SELECT positions
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT connection

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      // No targetPosition — both nodes already exist; secondsRemaining and slots come from the old connection's data
      payload: { fromZoneId: VALID_ZONE_A, toZoneId: VALID_ZONE_B, secondsRemaining: 900, slots: 7, fromHandleId: 'handle-src', toHandleId: 'handle-dst' },
    });
    expect(res.statusCode).toBe(201);

    // Verify the INSERT connection query used the correct handle IDs
    const insertConnCall = mockDb.query.mock.calls.find((call: any[]) =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO connections')
    );
    expect(insertConnCall).toBeDefined();
    const insertParams = insertConnCall[1];
    expect(insertParams).toContain('handle-src');
    expect(insertParams).toContain('handle-dst');
  });

  it('allows connection when handles exist but are not disabled', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'test-chain-id' }] }); // fromZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // toZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections check
    mockDb.query.mockResolvedValueOnce({ rows: [{ custom_handles: [{ id: 'handle-from', left: '50%', top: '0%' }] }] }); // from-zone handles
    mockDb.query.mockResolvedValueOnce({ rows: [{ custom_handles: [{ id: 'handle-to', left: '50%', top: '100%' }] }] }); // to-zone handles
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE source node features
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE target node features
    mockDb.query.mockResolvedValueOnce({ rows: [{ zone_id: VALID_ZONE_B, x: 0, y: 0, features: {}, custom_handles: null }] }); // SELECT positions
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT connection

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { fromZoneId: VALID_ZONE_A, toZoneId: VALID_ZONE_B, secondsRemaining: 1800, slots: 7, fromHandleId: 'handle-from', toHandleId: 'handle-to' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('requires authorization', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      payload: { fromZoneId: VALID_ZONE_A, toZoneId: VALID_ZONE_B, secondsRemaining: 1800, slots: 7 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects when slots is missing', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'test-chain-id' }] }); // fromZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // toZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections check
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { fromZoneId: VALID_ZONE_A, toZoneId: VALID_ZONE_B, secondsRemaining: 1800 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/slots/i);
  });

  it('rejects when slots is an invalid value', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'test-chain-id' }] }); // fromZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // toZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections check
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { fromZoneId: VALID_ZONE_A, toZoneId: VALID_ZONE_B, secondsRemaining: 1800, slots: 5 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/slots/i);
  });

  it('creates a connection with slots=7 and stores it in node features', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'test-chain-id' }] }); // fromZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // toZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections check
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // memory check (no existing memory)
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT node position (target)
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE node position (source)
    mockDb.query.mockResolvedValueOnce({ rows: [{ zone_id: VALID_ZONE_B, x: 100, y: 200, features: { slots: 7 }, custom_handles: null }] }); // SELECT positions
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT connection

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { fromZoneId: VALID_ZONE_A, toZoneId: VALID_ZONE_B, secondsRemaining: 1800, slots: 7, targetPosition: { x: 100, y: 200 } },
    });
    expect(res.statusCode).toBe(201);

    // Verify the INSERT node position query included slots in features
    const insertCall = mockDb.query.mock.calls.find((call: any[]) =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO room_node_positions')
    );
    expect(insertCall).toBeDefined();
    const featuresArg = JSON.parse(insertCall[1][4]);
    expect(featuresArg.slots).toBe(7);
  });

  it('creates a connection with slots=20 and stores it in node features', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'test-chain-id' }] }); // fromZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // toZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections check
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // memory check (no existing memory)
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT node position (target)
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE node position (source)
    mockDb.query.mockResolvedValueOnce({ rows: [{ zone_id: VALID_ZONE_B, x: 100, y: 200, features: { slots: 20 }, custom_handles: null }] }); // SELECT positions
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT connection

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { fromZoneId: VALID_ZONE_A, toZoneId: VALID_ZONE_B, secondsRemaining: 1800, slots: 20, targetPosition: { x: 100, y: 200 } },
    });
    expect(res.statusCode).toBe(201);

    const insertCall = mockDb.query.mock.calls.find((call: any[]) =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO room_node_positions')
    );
    expect(insertCall).toBeDefined();
    const featuresArg = JSON.parse(insertCall[1][4]);
    expect(featuresArg.slots).toBe(20);
  });

  it('replaces stale memory handles with fresh shape defaults when count differs for a shaped zone', async () => {
    // sases-aoarsum is a roads zone with mapShape 's' (6 default handles)
    const SHAPED_ZONE = 'sases-aoarsum';
    // Stale memory has only 5 handles (wrong count)
    const staleHandles = [
      { id: 's-p1', top: '35.55%', left: '14.45%' },
      { id: 's-p2', top: '80.47%', left: '30.47%' },
      { id: 's-p3', top: '12.11%', left: '37.89%' },
      { id: 's-p4', top: '22.27%', left: '72.27%' },
      { id: 's-p5', top: '53.52%', left: '96.48%' },
    ];

    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'test-chain-id' }] }); // fromZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // toZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections check
    mockDb.query.mockResolvedValueOnce({ rows: [{ features: { slots: 7 }, custom_handles: staleHandles }] }); // memory check
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT node position
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // SELECT times_added (no existing — shouldAppend=true)
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT/UPDATE memory
    mockDb.query.mockResolvedValueOnce({ rows: [{ zone_id: SHAPED_ZONE, times_added: [new Date().toISOString()], features: { slots: 7 }, custom_handles: staleHandles, last_updated: new Date().toISOString() }] }); // SELECT updated memory
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE source node lastUpdatedAt
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // SELECT positions (broadcast)
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT connection

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { fromZoneId: VALID_ZONE_A, toZoneId: SHAPED_ZONE, secondsRemaining: 1800, slots: 7, targetPosition: { x: 100, y: 200 } },
    });
    expect(res.statusCode).toBe(201);

    const insertCall = mockDb.query.mock.calls.find((call: any[]) =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO room_node_positions')
    );
    expect(insertCall).toBeDefined();
    const handlesArg = JSON.parse(insertCall[1][5]);
    expect(handlesArg).toHaveLength(6);
    expect(handlesArg.map((h: any) => h.id)).toEqual(['s-p1', 's-p2', 's-p3', 's-p4', 's-p5', 's-p6']);

    // Memory INSERT must also receive the corrected 6 handles
    const memInsertCall = mockDb.query.mock.calls.find((call: any[]) =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO room_node_memory')
    );
    expect(memInsertCall).toBeDefined();
    const memHandlesArg = JSON.parse(memInsertCall[1][4]);
    expect(memHandlesArg).toHaveLength(6);
    expect(memHandlesArg.map((h: any) => h.id)).toEqual(['s-p1', 's-p2', 's-p3', 's-p4', 's-p5', 's-p6']);
  });

  it('replaces stale memory handles with fresh shape defaults when positions differ for a shaped zone', async () => {
    // sases-aoarsum is a roads zone with mapShape 's' (6 default handles)
    const SHAPED_ZONE = 'sases-aoarsum';
    // Memory has 6 handles but with moved positions (not matching defaults)
    const movedHandles = [
      { id: 's-p1', top: '10.00%', left: '20.00%' },
      { id: 's-p2', top: '30.00%', left: '40.00%' },
      { id: 's-p3', top: '50.00%', left: '60.00%' },
      { id: 's-p4', top: '70.00%', left: '80.00%' },
      { id: 's-p5', top: '15.00%', left: '25.00%' },
      { id: 's-p6', top: '35.00%', left: '45.00%' },
    ];

    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'test-chain-id' }] }); // fromZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // toZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections check
    mockDb.query.mockResolvedValueOnce({ rows: [{ features: { slots: 7 }, custom_handles: movedHandles }] }); // memory check
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT node position
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // SELECT times_added (no existing — shouldAppend=true)
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT/UPDATE memory
    mockDb.query.mockResolvedValueOnce({ rows: [{ zone_id: SHAPED_ZONE, times_added: [new Date().toISOString()], features: { slots: 7 }, custom_handles: movedHandles, last_updated: new Date().toISOString() }] }); // SELECT updated memory
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE source node lastUpdatedAt
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // SELECT positions (broadcast)
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT connection

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { fromZoneId: VALID_ZONE_A, toZoneId: SHAPED_ZONE, secondsRemaining: 1800, slots: 7, targetPosition: { x: 100, y: 200 } },
    });
    expect(res.statusCode).toBe(201);

    const insertCall = mockDb.query.mock.calls.find((call: any[]) =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO room_node_positions')
    );
    expect(insertCall).toBeDefined();
    const handlesArg = JSON.parse(insertCall[1][5]);
    // Positions should be reset to defaults (sases-aoarsum shape 's', s-p1 default: left=73.20%, top=23.20%)
    expect(handlesArg).toHaveLength(6);
    expect(handlesArg[0].left).toBe('73.20%');
    expect(handlesArg[0].top).toBe('23.20%');

    // Memory INSERT must also receive the corrected default positions
    const memInsertCall = mockDb.query.mock.calls.find((call: any[]) =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO room_node_memory')
    );
    expect(memInsertCall).toBeDefined();
    const memHandlesArg = JSON.parse(memInsertCall[1][4]);
    expect(memHandlesArg).toHaveLength(6);
    expect(memHandlesArg[0].left).toBe('73.20%');
    expect(memHandlesArg[0].top).toBe('23.20%');
  });

  it('preserves disabled flags from stale handles when resetting to shape defaults', async () => {
    const SHAPED_ZONE = 'sases-aoarsum';
    // Memory has 5 handles, one is disabled
    const staleHandles = [
      { id: 's-p1', top: '35.55%', left: '14.45%', disabled: true },
      { id: 's-p2', top: '80.47%', left: '30.47%' },
      { id: 's-p3', top: '12.11%', left: '37.89%' },
      { id: 's-p4', top: '22.27%', left: '72.27%' },
      { id: 's-p5', top: '53.52%', left: '96.48%' },
    ];

    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'test-chain-id' }] }); // fromZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // toZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections check
    mockDb.query.mockResolvedValueOnce({ rows: [{ features: { slots: 7 }, custom_handles: staleHandles }] }); // memory check
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT node position
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // SELECT times_added (no existing — shouldAppend=true)
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT/UPDATE memory
    mockDb.query.mockResolvedValueOnce({ rows: [{ zone_id: SHAPED_ZONE, times_added: [new Date().toISOString()], features: { slots: 7 }, custom_handles: staleHandles, last_updated: new Date().toISOString() }] }); // SELECT updated memory
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE source node lastUpdatedAt
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // SELECT positions (broadcast)
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT connection

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { fromZoneId: VALID_ZONE_A, toZoneId: SHAPED_ZONE, secondsRemaining: 1800, slots: 7, targetPosition: { x: 100, y: 200 } },
    });
    expect(res.statusCode).toBe(201);

    const insertCall = mockDb.query.mock.calls.find((call: any[]) =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO room_node_positions')
    );
    expect(insertCall).toBeDefined();
    const handlesArg = JSON.parse(insertCall[1][5]);
    expect(handlesArg).toHaveLength(6);
    // s-p1 was disabled in stale data — disabled flag should be preserved
    const p1 = handlesArg.find((h: any) => h.id === 's-p1');
    expect(p1.disabled).toBe(true);
    // s-p6 is new (didn't exist in stale) — should not be disabled
    const p6 = handlesArg.find((h: any) => h.id === 's-p6');
    expect(p6.disabled).toBeUndefined();

    // Memory INSERT must also receive the corrected 6 handles with disabled flag preserved
    const memInsertCall = mockDb.query.mock.calls.find((call: any[]) =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO room_node_memory')
    );
    expect(memInsertCall).toBeDefined();
    const memHandlesArg = JSON.parse(memInsertCall[1][4]);
    expect(memHandlesArg).toHaveLength(6);
    const memP1 = memHandlesArg.find((h: any) => h.id === 's-p1');
    expect(memP1.disabled).toBe(true);
    const memP6 = memHandlesArg.find((h: any) => h.id === 's-p6');
    expect(memP6.disabled).toBeUndefined();
  });

  it('updates memory in-place when handles are stale but zone was added recently (within 3 hours)', async () => {
    const SHAPED_ZONE = 'sases-aoarsum';
    // Stale memory has only 5 handles (wrong count), added 17 minutes ago (within 3-hour guard)
    const recentTimestamp = new Date(Date.now() - 17 * 60 * 1000).toISOString();
    const staleHandles = [
      { id: 's-p1', top: '35.55%', left: '14.45%' },
      { id: 's-p2', top: '80.47%', left: '30.47%' },
      { id: 's-p3', top: '12.11%', left: '37.89%' },
      { id: 's-p4', top: '22.27%', left: '72.27%' },
      { id: 's-p5', top: '53.52%', left: '96.48%' },
    ];

    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'test-chain-id' }] }); // fromZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // toZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections check
    mockDb.query.mockResolvedValueOnce({ rows: [{ features: { slots: 7 }, custom_handles: staleHandles }] }); // memory check (returns stale)
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT node position
    mockDb.query.mockResolvedValueOnce({ rows: [{ times_added: [recentTimestamp] }] }); // SELECT times_added (recent — shouldAppend=false)
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE room_node_memory (handles corrected in-place)
    mockDb.query.mockResolvedValueOnce({ rows: [{ zone_id: SHAPED_ZONE, times_added: [recentTimestamp], features: { slots: 7 }, custom_handles: null, last_updated: new Date().toISOString() }] }); // SELECT updated memory
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE source node lastUpdatedAt
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // SELECT positions (broadcast)
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT connection

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { fromZoneId: VALID_ZONE_A, toZoneId: SHAPED_ZONE, secondsRemaining: 1800, slots: 7, targetPosition: { x: 100, y: 200 } },
    });
    expect(res.statusCode).toBe(201);

    // Node position must have 6 corrected handles
    const insertCall = mockDb.query.mock.calls.find((call: any[]) =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO room_node_positions')
    );
    expect(insertCall).toBeDefined();
    const handlesArg = JSON.parse(insertCall[1][5]);
    expect(handlesArg).toHaveLength(6);
    expect(handlesArg.map((h: any) => h.id)).toEqual(['s-p1', 's-p2', 's-p3', 's-p4', 's-p5', 's-p6']);

    // Memory must be updated in-place (UPDATE, not INSERT) with the corrected 6 handles
    const memUpdateCall = mockDb.query.mock.calls.find((call: any[]) =>
      typeof call[0] === 'string' && call[0].includes('UPDATE room_node_memory')
    );
    expect(memUpdateCall).toBeDefined();
    const memHandlesArg = JSON.parse(memUpdateCall[1][0]);
    expect(memHandlesArg).toHaveLength(6);
    expect(memHandlesArg.map((h: any) => h.id)).toEqual(['s-p1', 's-p2', 's-p3', 's-p4', 's-p5', 's-p6']);

    // No new timestamp should have been appended (no INSERT INTO room_node_memory)
    const memInsertCall = mockDb.query.mock.calls.find((call: any[]) =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO room_node_memory')
    );
    expect(memInsertCall).toBeUndefined();
  });

  it('preserves rotated shape handles from memory when re-adding a zone (rotation bug fix)', async () => {
    // sases-aoarsum has mapShape 's' — 6 handles. These are the 180°-rotated positions (each coord = 100 - default).
    const SHAPED_ZONE = 'sases-aoarsum';
    const rotatedHandles = [
      { id: 's-p1', top: '76.80%', left: '26.80%' },
      { id: 's-p2', top: '37.80%', left: '12.20%' },
      { id: 's-p3', top: '20.80%', left: '29.20%' },
      { id: 's-p4', top: '27.80%', left: '77.80%' },
      { id: 's-p5', top: '60.20%', left: '89.80%' },
      { id: 's-p6', top: '82.20%', left: '67.80%' },
    ];

    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'test-chain-id' }] }); // fromZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // toZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections check
    mockDb.query.mockResolvedValueOnce({ rows: [{ features: { slots: 7 }, custom_handles: rotatedHandles, rotation: 2 }] }); // memory check
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT node position
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // SELECT times_added (no existing — shouldAppend=true)
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT/UPDATE memory
    mockDb.query.mockResolvedValueOnce({ rows: [{ zone_id: SHAPED_ZONE, times_added: [new Date().toISOString()], features: { slots: 7 }, custom_handles: rotatedHandles, rotation: 2, last_updated: new Date().toISOString() }] }); // SELECT updated memory
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE source node lastUpdatedAt
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // SELECT positions (broadcast)
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT connection

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { fromZoneId: VALID_ZONE_A, toZoneId: SHAPED_ZONE, secondsRemaining: 1800, slots: 7, targetPosition: { x: 100, y: 200 } },
    });
    expect(res.statusCode).toBe(201);

    const insertCall = mockDb.query.mock.calls.find((call: any[]) =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO room_node_positions')
    );
    expect(insertCall).toBeDefined();
    const handlesArg = JSON.parse(insertCall[1][5]);
    const rotationArg = insertCall[1][7];

    // Rotated handles must be preserved exactly — not replaced with defaults
    expect(handlesArg).toHaveLength(6);
    expect(handlesArg[0].top).toBe('76.80%');
    expect(handlesArg[0].left).toBe('26.80%');
    // Rotation must also be preserved
    expect(rotationArg).toBe(2);
  });

  it('retains hideout handles and rotation when re-adding the zone', async () => {
    const customHandles = [
      { id: 'n', left: '10%', top: '10%' }, // Moved from default 75%, 25%
      { id: 'e', left: '75%', top: '75%' },
      { id: 's', left: '25%', top: '75%' },
      { id: 'w', left: '25%', top: '25%' },
    ];

    // 1. First addition of the zone (no memory)
    mockDb.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ id: roomId }] }) // SELECT id FROM rooms
      .mockResolvedValueOnce({ rows: [{ chain_id: 'test-chain-id' }] }) // fromZoneId chain lookup
      .mockResolvedValueOnce({ rows: [] }) // toZoneId chain lookup
      .mockResolvedValueOnce({ rows: [] }) // SELECT * FROM connections
      .mockResolvedValueOnce({ rows: [] }) // memoryCheck
      .mockResolvedValueOnce({ rows: [] }) // INSERT room_node_positions
      .mockResolvedValueOnce({ rows: [] }) // shouldAppend check
      .mockResolvedValueOnce({ rows: [] }) // UPDATE room_node_positions (from)
      .mockResolvedValueOnce({ rows: [{ zone_id: VALID_ZONE_A, x: 0, y: 0, features: {}, custom_handles: null, rotation: 0 }] }) // final broadcast positions
      .mockResolvedValueOnce({ rows: [] }); // INSERT connections

    await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        fromZoneId: VALID_ZONE_A,
        toZoneId: VALID_ZONE_B,
        secondsRemaining: 1800,
        slots: 7,
        targetPosition: { x: 100, y: 100 }
      }
    });

    // 2. Re-adding the zone with custom handles in memory
    mockDb.query.mockReset();
    mockDb.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ id: roomId }] }) // SELECT id FROM rooms
      .mockResolvedValueOnce({ rows: [{ chain_id: 'test-chain-id' }] }) // fromZoneId chain lookup
      .mockResolvedValueOnce({ rows: [] }) // toZoneId chain lookup
      .mockResolvedValueOnce({ rows: [] }) // SELECT * FROM connections
      .mockResolvedValueOnce({ rows: [{
        features: { resources: ['ore'] },
        custom_handles: customHandles,
        rotation: 45
      }] }) // memoryCheck - RETURN CUSTOM HANDLES AND ROTATION
      .mockResolvedValueOnce({ rows: [] }) // INSERT room_node_positions
      .mockResolvedValueOnce({ rows: [{ times_added: [new Date().toISOString()] }] }) // shouldAppend check
      .mockResolvedValueOnce({ rows: [] }) // UPDATE room_node_positions (from)
      .mockResolvedValueOnce({ rows: [{ zone_id: VALID_ZONE_A, x: 0, y: 0, features: {}, custom_handles: null, rotation: 0 }] }) // final broadcast positions
      .mockResolvedValueOnce({ rows: [] }); // INSERT connections

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        fromZoneId: VALID_ZONE_A,
        toZoneId: VALID_ZONE_B,
        secondsRemaining: 1800,
        slots: 7,
        targetPosition: { x: 100, y: 100 }
      }
    });

    expect(res.statusCode).toBe(201);

    // Verify what was inserted into room_node_positions
    const insertPosCall = mockDb.query.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO room_node_positions')
    );

    const insertedHandles = JSON.parse(insertPosCall[1][5]);
    const insertedRotation = insertPosCall[1][7];

    // It should retain our custom positions
    const nHandle = insertedHandles.find((h: any) => h.id === 'n');
    expect(nHandle.left).toBe('10%');
    expect(nHandle.top).toBe('10%');
    expect(insertedRotation).toBe(45);
  });

  it('does NOT save non-roads zones to memory when creating connections', async () => {
    const VALID_ROADS_ZONE = 'cases-ugumlos'; // A roads zone
    const VALID_NON_ROADS_ZONE = 'adrens-hill'; // A royal yellow zone

    // Mock room check
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // SELECT id FROM rooms
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'test-chain-id' }] }); // fromZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // toZoneId chain lookup
    // Mock connections check (no cycles)
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // SELECT * FROM connections
    // Mock memory check (no existing memory)
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // SELECT times_added FROM room_node_memory

    // Test through HTTP API
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        fromZoneId: VALID_ROADS_ZONE,
        toZoneId: VALID_NON_ROADS_ZONE,
        secondsRemaining: 1800,
        slots: 7,
        targetPosition: { x: 200, y: 200 }
      }
    });

    expect(res.statusCode).toBe(201);

    // Verify INSERT INTO room_node_memory was NOT called
    const insertCall = mockDb.query.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO room_node_memory')
    );
    expect(insertCall).toBeUndefined();
  });
});

describe('PATCH /api/rooms/:id/connections/:connId', () => {
  it('UpdateConnectionBodySchema behavior with null', () => {
    const result = UpdateConnectionBodySchema.safeParse({ fromHandleId: null });
    expect(result.success).toBe(true);
    expect(result.data?.fromHandleId).toBe(null);
  });

  it('UpdateConnectionBodySchema behavior with empty object', () => {
    const result = UpdateConnectionBodySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('returns Required if body is empty', async () => {
    const connId = 'test-conn';
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room existence check

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${roomId}/connections/${connId}`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      // No payload
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 404 if connection not found when fromHandleId is null', async () => {
    const connId = 'test-conn';
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room existence check
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connection not found

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${roomId}/connections/${connId}`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      payload: { fromHandleId: null }
    });

    expect(res.statusCode).toBe(404);
  });

  it('updates a connection', async () => {
    // PATCH /api/rooms/:id/connections/:connId
    const connId = 'conn-1';

    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room existence check
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: connId, from_zone_id: VALID_ZONE_A, to_zone_id: VALID_ZONE_B }] }); // connection existence check
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE connections
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE room_node_positions
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // SELECT positions (for broadcast)
    // analytics fire-and-forget calls (rooms_modified global, room daily, room alltime)
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockDb.query.mockResolvedValueOnce({ rows: [{
      id: connId, room_id: roomId, from_zone_id: VALID_ZONE_A, to_zone_id: VALID_ZONE_B,
      expires_at: new Date(Date.now() + 120 * 60 * 1000).toISOString(),
      reported_at: new Date().toISOString(), reported_by: null
    }] }); // SELECT updated connection

    const updateRes = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${roomId}/connections/${connId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { secondsRemaining: 7200 },
    });

    expect(updateRes.statusCode).toBe(200);
    const updatedConn = updateRes.json<Connection>();
    expect(updatedConn.id).toBe(connId);
  });
});

describe('GET /api/rooms/:id/connections', () => {
  it('returns active and expired connections, omits deleted ones', async () => {
    const now = Date.now();

    const activeConn = {
      id: 'active',
      room_id: roomId,
      from_zone_id: VALID_ZONE_A,
      to_zone_id: VALID_ZONE_B,
      expires_at: new Date(now + 60 * 60 * 1000).toISOString(),
      reported_at: new Date(now).toISOString(),
      reported_by: null,
    };

    const expiredConn = {
      id: 'expired',
      room_id: roomId,
      from_zone_id: VALID_ZONE_A,
      to_zone_id: VALID_ZONE_B,
      expires_at: new Date(now - 60 * 60 * 1000).toISOString(),
      reported_at: new Date(now - 90 * 60 * 1000).toISOString(),
      reported_by: null,
    };

    const deletedConn = {
      id: 'deleted',
      room_id: roomId,
      from_zone_id: VALID_ZONE_A,
      to_zone_id: VALID_ZONE_B,
      expires_at: new Date(now - 7 * 60 * 60 * 1000).toISOString(),
      reported_at: new Date(now - 8 * 60 * 60 * 1000).toISOString(),
      reported_by: null,
    };

    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [activeConn, expiredConn, deletedConn] });

    const res = await app.inject({
      method: 'GET',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const connections = res.json<Connection[]>();
    const ids = connections.map((c) => c.id);

    expect(ids).toContain(activeConn.id);
    expect(ids).toContain(expiredConn.id);
    expect(ids).not.toContain(deletedConn.id);
  });
});

describe('DELETE /api/rooms/:id/connections/:connId', () => {
  it('deletes the connection and removes orphaned node, but keeps home node', async () => {
    const zoneA = VALID_ZONE_A;
    const zoneB = VALID_ZONE_B;
    const conn1Id = 'conn-1';

    // SELECT from connections (lookup endpoints)
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: conn1Id, from_zone_id: zoneA, to_zone_id: zoneB }] });
    // DELETE from connections
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    // Set-based orphan SELECT — server treats zoneA as a chain source (excluded)
    // and returns only zoneB as orphan.
    mockDb.query.mockResolvedValueOnce({ rows: [{ zone_id: zoneB }] });
    // Batch DELETE from room_node_positions (ANY)
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}/connections/${conn1Id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);
  });

  it('protects a secondary chain source from being deleted as an orphan, and batches removed zones into a single connection_removed broadcast', async () => {
    // Scenario from the issue: a secondary chain has only one connection,
    // from its source (zoneB) to a downstream zone. Deleting that connection
    // must NOT delete the chain-source node, only the downstream zone. The
    // deletion must be transmitted to the client in ONE batched message
    // (`connection_removed` with `removedZoneIds`), not via per-zone loops.
    const sourceZone = VALID_ZONE_B; // secondary chain source
    const downstreamZone = 'cetitos-aiayrom'; // unrelated downstream zone
    const connId = 'conn-secondary';

    // SELECT from connections (lookup endpoints)
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: connId, from_zone_id: sourceZone, to_zone_id: downstreamZone }] });
    // DELETE from connections
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    // Set-based orphan SELECT — server-side query excludes the chain source
    // (sourceZone), so only the downstream zone is returned.
    mockDb.query.mockResolvedValueOnce({ rows: [{ zone_id: downstreamZone }] });
    // Batch DELETE from room_node_positions
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const broadcastMock = vi.mocked(broadcast);
    broadcastMock.mockClear();

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}/connections/${connId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);

    // The batched position DELETE should target ONLY the downstream zone
    // (chain source was excluded by the orphan-detection query).
    const deletePositionCalls = mockDb.query.mock.calls.filter((call: any[]) =>
      typeof call[0] === 'string' && call[0].includes('DELETE FROM room_node_positions')
    );
    expect(deletePositionCalls).toHaveLength(1);
    expect(deletePositionCalls[0][1]).toEqual([roomId, [downstreamZone]]);

    // The deletion must be transmitted to the client as a SINGLE batched
    // `connection_removed` message carrying both the connection id and the
    // list of zones that became orphaned — not via a per-zone loop or a
    // separate `node_positions_updated` snapshot.
    const removalBroadcasts = broadcastMock.mock.calls.filter(
      (call: any[]) => call[0] === roomId && (call[1]?.type === 'connection_removed' || call[1]?.type === 'node_positions_updated')
    );
    expect(removalBroadcasts).toHaveLength(1);
    expect(removalBroadcasts[0][1]).toMatchObject({
      type: 'connection_removed',
      connectionId: connId,
      removedZoneIds: [downstreamZone],
    });
  });
});

describe('DELETE /api/rooms/:id/connections/:connId — map history preservation', () => {
  // Map history (room_node_memory) must survive every implicit map edit —
  // it is only ever deleted via the explicit memory endpoints
  // (DELETE /api/rooms/:id/memory and /memory/:zoneId). These tests guard
  // against the regression where orphan cleanup wiped a zone's entire
  // times_added visit log as a side effect of deleting a connection.

  it('preserves the orphaned zone\'s map history when its last connection is deleted', async () => {
    const connId = 'conn-history-1';

    mockDb.query.mockResolvedValueOnce({ rows: [{ id: connId, from_zone_id: VALID_ZONE_A, to_zone_id: VALID_ZONE_B }] }); // connection lookup
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // DELETE FROM connections
    mockDb.query.mockResolvedValueOnce({ rows: [{ zone_id: VALID_ZONE_B }] }); // orphan SELECT — zoneB now has no connections
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // DELETE FROM room_node_positions

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}/connections/${connId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);

    // The orphaned zone's node position goes, but its map history stays.
    const positionDeleteCalls = mockDb.query.mock.calls.filter((call: any[]) =>
      typeof call[0] === 'string' && call[0].includes('DELETE FROM room_node_positions')
    );
    expect(positionDeleteCalls).toHaveLength(1);
    expect(positionDeleteCalls[0][1]).toEqual([roomId, [VALID_ZONE_B]]);

    const memoryDeleteCalls = mockDb.query.mock.calls.filter((call: any[]) =>
      typeof call[0] === 'string' && call[0].includes('DELETE FROM room_node_memory')
    );
    expect(memoryDeleteCalls).toHaveLength(0);
  });

  it('leaves map history untouched when neither endpoint zone becomes orphaned', async () => {
    const connId = 'conn-history-2';

    mockDb.query.mockResolvedValueOnce({ rows: [{ id: connId, from_zone_id: VALID_ZONE_A, to_zone_id: VALID_ZONE_B }] }); // connection lookup
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // DELETE FROM connections
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // orphan SELECT — both zones still have other connections

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}/connections/${connId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);

    const memoryDeleteCalls = mockDb.query.mock.calls.filter((call: any[]) =>
      typeof call[0] === 'string' && call[0].includes('DELETE FROM room_node_memory')
    );
    expect(memoryDeleteCalls).toHaveLength(0);
  });

  it('preserves the map history of every zone in a branch pruned leaf-to-root (recursive delete flow)', async () => {
    // Mirrors the client's onDeleteRecursive / node delete flow: a branch
    // home → Z1 → Z2 → Z3 is pruned by deleting its connections in reverse
    // order. Each request orphans one more zone; every orphan's node position
    // is removed but its history row must survive all three deletions.
    const HOME = VALID_ZONE_A;
    const Z1 = VALID_ZONE_B;
    const Z2 = 'cetitos-aiayrom';
    const Z3 = 'sases-aoarsum';

    const branch = [
      { connId: 'conn-z2-z3', from: Z2, to: Z3, orphaned: Z3 },
      { connId: 'conn-z1-z2', from: Z1, to: Z2, orphaned: Z2 },
      { connId: 'conn-home-z1', from: HOME, to: Z1, orphaned: Z1 },
    ];

    for (const step of branch) {
      mockDb.query.mockResolvedValueOnce({ rows: [{ id: step.connId, from_zone_id: step.from, to_zone_id: step.to }] }); // connection lookup
      mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // DELETE FROM connections
      mockDb.query.mockResolvedValueOnce({ rows: [{ zone_id: step.orphaned }] }); // orphan SELECT — the to-zone is now orphaned
      mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // DELETE FROM room_node_positions

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/rooms/${roomId}/connections/${step.connId}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(204);
    }

    // Every orphaned zone's position was removed…
    const positionDeleteCalls = mockDb.query.mock.calls.filter((call: any[]) =>
      typeof call[0] === 'string' && call[0].includes('DELETE FROM room_node_positions')
    );
    expect(positionDeleteCalls.flatMap((call: any[]) => call[1][1])).toEqual([Z3, Z2, Z1]);

    // …but not a single map history row was touched.
    const memoryDeleteCalls = mockDb.query.mock.calls.filter((call: any[]) =>
      typeof call[0] === 'string' && call[0].includes('DELETE FROM room_node_memory')
    );
    expect(memoryDeleteCalls).toHaveLength(0);
  });
});

describe('DELETE /api/rooms/:id/connections (Reset)', () => {
  it('deletes all connections and node positions (except home) without requiring admin password', async () => {
    const zoneA = VALID_ZONE_A; // Home

    const mockClient = await mockDb.connect();
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockClient.query.mockResolvedValueOnce({ rows: [{ admin_password_hash: 'irrelevant', home_zone_id: zoneA }] }); // SELECT room
    mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // DELETE FROM connections
    mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // DELETE FROM room_node_positions
    mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE rooms
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // COMMIT

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);
  });

  it('returns 403 when token is for a different room', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/other-room-id/connections`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 when room does not exist', async () => {
    const mockClient = await mockDb.connect();
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // SELECT room — not found
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('Connection lastUpdatedAt refresh', () => {
  it('updates lastUpdatedAt for source and target zones on POST', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'test-chain-id' }] }); // fromZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // toZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections check
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT node position (target)
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE node position (source)
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // SELECT positions (for broadcast)
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT connection

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { fromZoneId: VALID_ZONE_A, toZoneId: VALID_ZONE_B, secondsRemaining: 1800, slots: 7 },
    });

    expect(res.statusCode).toBe(201);

    const updateCalls = mockDb.query.mock.calls.filter((call: any[]) =>
      call[0].includes('UPDATE room_node_positions') || call[0].includes('INSERT INTO room_node_positions')
    );

    // Should have calls that set lastUpdatedAt
    const lastUpdateCalls = updateCalls.filter((call: any[]) => call[0].includes('lastUpdatedAt'));
    expect(lastUpdateCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('updates lastUpdatedAt for both zones on PATCH', async () => {
    const connId = 'conn-1';
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: connId, from_zone_id: VALID_ZONE_A, to_zone_id: VALID_ZONE_B }] }); // connection check
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE connection
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE node positions
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // SELECT positions (for broadcast)
    // analytics fire-and-forget calls (rooms_modified global, room daily, room alltime)
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: connId, expires_at: new Date().toISOString() }] }); // SELECT updated connection

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${roomId}/connections/${connId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { secondsRemaining: 3600 },
    });

    expect(res.statusCode).toBe(200);

    const updateCall = mockDb.query.mock.calls.find((call: any[]) =>
      call[0].includes('UPDATE room_node_positions') && call[0].includes('lastUpdatedAt')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[1]).toContain(VALID_ZONE_A);
    expect(updateCall[1]).toContain(VALID_ZONE_B);
  });
});

describe('Multi-portal-pair: two connections between same zone pair', () => {
  // Zones used for this scenario — both are real roads zones in the catalogue
  const QUAENT = 'quaent-al-nusis';
  const CIEITOS = 'cieitos-obaelos';

  it('allows a second portal pair connection between quaent-al-nusis and cieitos-obaelos when the first uses different handles', async () => {
    const futureExpiry = new Date(Date.now() + 3_600_000).toISOString();
    const reportedAt = new Date().toISOString();

    // Existing connection: quaent (e) → cieitos (c-p1) — already on the map
    const existingDbRow = {
      id: 'existing-conn-1',
      room_id: roomId,
      from_zone_id: QUAENT,
      to_zone_id: CIEITOS,
      from_handle_id: 'e',
      to_handle_id: 'c-p1',
      expires_at: futureExpiry,
      reported_at: reportedAt,
      reported_by: null,
      chain_id: 'iAIGCt5pnw9pbDZ74oxAE',
    };

    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'iAIGCt5pnw9pbDZ74oxAE' }] }); // fromZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'iAIGCt5pnw9pbDZ74oxAE' }] }); // toZoneId chain lookup (same chain — allowed)
    mockDb.query.mockResolvedValueOnce({ rows: [existingDbRow] }); // connections check (first portal pair)
    mockDb.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT connection

    // Second portal pair: quaent (e2) → cieitos (c-p2) — different handles from the first pair
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        fromZoneId: QUAENT,
        toZoneId: CIEITOS,
        fromHandleId: 'e2',
        toHandleId: 'c-p2',
        secondsRemaining: 1800,
        slots: 7,
      },
    });

    expect(res.statusCode).toBe(201);
    const conn = res.json<{ fromZoneId: string; toZoneId: string }>();
    expect(conn.fromZoneId).toBe(QUAENT);
    expect(conn.toZoneId).toBe(CIEITOS);
  });

  it('still rejects when the same source handle is already occupied', async () => {
    const futureExpiry = new Date(Date.now() + 3_600_000).toISOString();
    const reportedAt = new Date().toISOString();

    // Existing connection already uses handle 'e' on quaent
    const existingDbRow = {
      id: 'existing-conn-1',
      room_id: roomId,
      from_zone_id: QUAENT,
      to_zone_id: CIEITOS,
      from_handle_id: 'e',
      to_handle_id: 'c-p1',
      expires_at: futureExpiry,
      reported_at: reportedAt,
      reported_by: null,
      chain_id: 'iAIGCt5pnw9pbDZ74oxAE',
    };

    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'iAIGCt5pnw9pbDZ74oxAE' }] }); // fromZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'iAIGCt5pnw9pbDZ74oxAE' }] }); // toZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [existingDbRow] }); // connections check

    // Attempt to reuse the same handle 'e' — must be rejected
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        fromZoneId: QUAENT,
        toZoneId: CIEITOS,
        fromHandleId: 'e',      // same handle as existing connection
        toHandleId: 'c-p2',
        secondsRemaining: 1800,
        slots: 7,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/source handle/i);
  });
});

describe('Cross-chain rejection', () => {
  it('rejects a connection whose target zone belongs to a different chain', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'chain-A' }] }); // fromZoneId chain lookup
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: 'chain-B' }] }); // toZoneId chain lookup (different chain)

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { fromZoneId: VALID_ZONE_A, toZoneId: VALID_ZONE_B, secondsRemaining: 1800, slots: 7 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/different chains/i);
  });

  it('rejects a connection whose source zone has no chain (orphaned)', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId }] }); // room check
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // fromZoneId chain lookup — no row

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { fromZoneId: VALID_ZONE_A, toZoneId: VALID_ZONE_B, secondsRemaining: 1800, slots: 7 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/not part of any chain/i);
  });
});
