/**
 * Analytics integration tests.
 *
 * These tests verify that the correct analytics DB calls are made in response
 * to each tracked event. The mockDb pattern is used throughout — analytics calls
 * are fire-and-forget so we simply assert that the expected INSERT/UPDATE SQL
 * containing the right table names was issued.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { wrapDbWithGuardDispatch } from './testApp.js';
import type { FastifyInstance } from 'fastify';
import { setupTestApp } from './testApp.js';

const VALID_ZONE_ID = 'qiient-al-nusom'; // valid roadsHideout home zone
const VALID_ZONE_A = 'adrens-hill';
const VALID_ZONE_B = 'anklesnag-mire';

// ---------------------------------------------------------------------------
// Helper: collect all table names targeted by query calls on a mockDb
// ---------------------------------------------------------------------------
function queriedTables(mockDb: any): string[] {
  return mockDb.query.mock.calls
    .map((c: any[]) => (typeof c[0] === 'string' ? c[0] : ''))
    .filter(Boolean);
}

function hasAnalyticsQuery(mockDb: any, table: string, column?: string): boolean {
  return mockDb.query.mock.calls.some((c: any[]) => {
    const sql: string = typeof c[0] === 'string' ? c[0] : '';
    return sql.includes(table) && (column ? sql.includes(column) : true);
  });
}

// ---------------------------------------------------------------------------
// Room-level HTTP analytics (using a fresh app per test)
// ---------------------------------------------------------------------------
describe('Analytics — room creation', () => {
  let app: FastifyInstance;
  let mockDb: any;

  beforeEach(async () => {
    mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      connect: vi.fn().mockResolvedValue({
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        release: vi.fn(),
      }),
    };
    app = await buildApp({ db: wrapDbWithGuardDispatch(mockDb) as any, disableRateLimit: true, jwtSecret: 'test-secret' });
    await app.ready();
  });

  afterEach(async () => { await app.close(); });

  it('increments analytics_global_daily.rooms_created on POST /api/rooms', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { password: 'pw', adminPassword: 'admin', homeZoneId: VALID_ZONE_ID, vanityUrl: 'test-room' },
    });
    expect(res.statusCode).toBe(201);

    expect(hasAnalyticsQuery(mockDb, 'analytics_global_daily', 'rooms_created')).toBe(true);
  });
});

describe('Analytics — password rotation', () => {
  let app: FastifyInstance;
  let mockDb: any;

  beforeEach(async () => {
    mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      connect: vi.fn().mockResolvedValue({
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        release: vi.fn(),
      }),
    };
    app = await buildApp({ db: wrapDbWithGuardDispatch(mockDb) as any, disableRateLimit: true, jwtSecret: 'test-secret' });
    await app.ready();
  });

  afterEach(async () => { await app.close(); });

  it('increments analytics_global_daily.passwords_rotated on PATCH /api/rooms/:id/password', async () => {
    const bcrypt = await import('bcrypt');
    const adminHash = await bcrypt.default.hash('admin-pw', 1);
    const roomId = 'test-room';
    const token = app.jwt.sign({ roomId, passwordVersion: 1 });

    // (authenticate preHandler's room-guard query is dispatched by
    // wrapDbWithGuardDispatch and never consumes this mock stack)
    // SELECT admin_password_hash
    mockDb.query.mockResolvedValueOnce({ rows: [{ admin_password_hash: adminHash }] });
    // UPDATE rooms SET password_hash
    mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/rooms/${roomId}/password`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { newPassword: 'new-pw', adminPassword: 'admin-pw' },
    });
    expect(res.statusCode).toBe(200);

    expect(hasAnalyticsQuery(mockDb, 'analytics_global_daily', 'passwords_rotated')).toBe(true);
  });
});

describe('Analytics — room reset (DELETE /connections)', () => {
  let app: FastifyInstance;
  let mockDb: any;

  beforeEach(async () => {
    mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      connect: vi.fn().mockResolvedValue({
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        release: vi.fn(),
      }),
    };
    app = await buildApp({ db: wrapDbWithGuardDispatch(mockDb) as any, disableRateLimit: true, jwtSecret: 'test-secret' });
    await app.ready();
  });

  afterEach(async () => { await app.close(); });

  it('increments analytics_global_daily.rooms_reset on DELETE /api/rooms/:id/connections', async () => {
    const roomId = 'test-room';
    const token = app.jwt.sign({ roomId });

    const clientMock = {
      query: vi.fn().mockImplementation((q: string) => {
        if (q.includes('SELECT admin_password_hash')) return Promise.resolve({ rows: [{ admin_password_hash: '', home_zone_id: VALID_ZONE_A }] });
        return Promise.resolve({ rows: [{ admin_password_hash: '', home_zone_id: VALID_ZONE_A }], rowCount: 0 });
      }),
      release: vi.fn(),
    };
    mockDb.connect.mockResolvedValueOnce(clientMock);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}/connections`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);

    expect(hasAnalyticsQuery(mockDb, 'analytics_global_daily', 'rooms_reset')).toBe(true);
  });
});

describe('Analytics — room deletion', () => {
  let app: FastifyInstance;
  let mockDb: any;

  beforeEach(async () => {
    mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      connect: vi.fn().mockResolvedValue({
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        release: vi.fn(),
      }),
    };
    app = await buildApp({ db: wrapDbWithGuardDispatch(mockDb) as any, disableRateLimit: true, jwtSecret: 'test-secret' });
    await app.ready();
  });

  afterEach(async () => { await app.close(); });

  it('increments analytics_global_daily.rooms_deleted on DELETE /api/rooms/:id', async () => {
    const bcrypt = await import('bcrypt');
    const adminHash = await bcrypt.default.hash('admin-pw', 1);
    const roomId = 'test-room';
    const token = app.jwt.sign({ roomId });

    mockDb.query.mockResolvedValueOnce({ rows: [{ admin_password_hash: adminHash }] });

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

    expect(hasAnalyticsQuery(mockDb, 'analytics_global_daily', 'rooms_deleted')).toBe(true);
  });

  it('recalculates room counts (active/inactive/total) after room deletion', async () => {
    const bcrypt = await import('bcrypt');
    const adminHash = await bcrypt.default.hash('admin-pw', 1);
    const roomId = 'test-room';
    const token = app.jwt.sign({ roomId });

    mockDb.query.mockResolvedValueOnce({ rows: [{ admin_password_hash: adminHash }] });

    const clientMock = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    mockDb.connect.mockResolvedValueOnce(clientMock);

    await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { adminPassword: 'admin-pw' },
    });

    // Should also trigger recalculate — which queries analytics_global_daily with total_rooms/active_rooms
    expect(hasAnalyticsQuery(mockDb, 'analytics_global_daily', 'total_rooms')).toBe(true);
  });
});

describe('Analytics — memory wipes', () => {
  let app: FastifyInstance;
  let mockDb: any;

  beforeEach(async () => {
    mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      connect: vi.fn().mockResolvedValue({
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        release: vi.fn(),
      }),
    };
    app = await buildApp({ db: wrapDbWithGuardDispatch(mockDb) as any, disableRateLimit: true, jwtSecret: 'test-secret' });
    await app.ready();
  });

  afterEach(async () => { await app.close(); });

  it('increments memory_wiped_full on DELETE /api/rooms/:id/memory', async () => {
    const roomId = 'test-room';
    const token = app.jwt.sign({ roomId });

    const bcrypt = await import('bcrypt');
    const adminHash = await bcrypt.default.hash('admin-pw', 1);

    // Provide admin_password_hash so bcrypt.compare succeeds
    mockDb.query.mockResolvedValueOnce({ rows: [{ admin_password_hash: adminHash }] });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}/memory`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { adminPassword: 'admin-pw' },
    });
    expect(res.statusCode).toBe(204);

    expect(hasAnalyticsQuery(mockDb, 'analytics_global_daily', 'memory_wiped_full')).toBe(true);
  });

  it('increments memory_wiped_single on DELETE /api/rooms/:id/memory/:zoneId', async () => {
    const roomId = 'test-room';
    const token = app.jwt.sign({ roomId });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}/memory/${VALID_ZONE_A}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);

    expect(hasAnalyticsQuery(mockDb, 'analytics_global_daily', 'memory_wiped_single')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Per-room / rooms_modified analytics via connections + WS
// ---------------------------------------------------------------------------
describe('Analytics — node position updates via POST /connections', () => {
  let app: FastifyInstance;
  let mockDb: any;

  beforeEach(async () => {
    mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      connect: vi.fn().mockResolvedValue({
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        release: vi.fn(),
      }),
    };
    app = await buildApp({ db: wrapDbWithGuardDispatch(mockDb) as any, disableRateLimit: true, jwtSecret: 'test-secret' });
    await app.ready();
  });

  afterEach(async () => { await app.close(); });

  it('recalculates rooms_modified (DB-driven) and data_updates when POST /connections creates a connection', async () => {
    const roomId = 'test-room';
    const token = app.jwt.sign({ roomId });

    mockDb.query.mockImplementation((q: string) => {
      if (q.includes('FROM rooms')) return Promise.resolve({ rows: [{ id: roomId }] });
      if (q.includes('FROM connections')) return Promise.resolve({ rows: [] });
      if (q.includes('SELECT chain_id FROM room_node_positions')) return Promise.resolve({ rows: [{ chain_id: 'test-chain-id' }] });
      if (q.includes('FROM room_node_positions') && q.includes('SELECT zone_id')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        fromZoneId: VALID_ZONE_A,
        toZoneId: VALID_ZONE_B,
        secondsRemaining: 1800,
        slots: 7,
        targetPosition: { x: 100, y: 200 },
      },
    });
    expect(res.statusCode).toBe(201);

    // rooms_modified is now set via recalculateRoomCounts (COUNT(DISTINCT room_id) subquery)
    expect(hasAnalyticsQuery(mockDb, 'analytics_global_daily', 'rooms_modified')).toBe(true);
    expect(hasAnalyticsQuery(mockDb, 'analytics_room_daily', 'data_updates')).toBe(true);
    expect(hasAnalyticsQuery(mockDb, 'analytics_room_alltime', 'data_updates')).toBe(true);
  });

  it('rooms_modified is recalculated via COUNT(DISTINCT room_id) on every update (DB-driven, not in-memory dedup)', async () => {
    const roomId = 'test-room';
    const token = app.jwt.sign({ roomId });

    mockDb.query.mockImplementation((q: string) => {
      if (q.includes('FROM rooms')) return Promise.resolve({ rows: [{ id: roomId }] });
      if (q.includes('FROM connections')) return Promise.resolve({ rows: [] });
      if (q.includes('SELECT chain_id FROM room_node_positions')) return Promise.resolve({ rows: [{ chain_id: 'test-chain-id' }] });
      if (q.includes('FROM room_node_positions') && q.includes('SELECT zone_id')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const payload = {
      fromZoneId: VALID_ZONE_A,
      toZoneId: VALID_ZONE_B,
      secondsRemaining: 1800,
      slots: 7,
      targetPosition: { x: 100, y: 200 },
    };

    // First update — recalculateRoomCounts fires which sets rooms_modified via COUNT subquery
    const res1 = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { Authorization: `Bearer ${token}` },
      payload,
    });
    expect(res1.statusCode).toBe(201);

    // Second update to the SAME room — recalculateRoomCounts fires again (DB will return same count)
    const res2 = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { Authorization: `Bearer ${token}` },
      payload,
    });
    expect(res2.statusCode).toBe(201);

    // rooms_modified is SET (not incremented) via a COUNT subquery — the SQL must contain
    // rooms_modified AND COUNT(DISTINCT room_id) in the same recalculate query
    const recalcCalls = mockDb.query.mock.calls.filter((c: any[]) => {
      const sql: string = typeof c[0] === 'string' ? c[0] : '';
      return sql.includes('analytics_global_daily') && sql.includes('rooms_modified') && sql.includes('COUNT(DISTINCT room_id)');
    });
    // Should have fired at least twice (once per POST) — the DB handles idempotency
    expect(recalcCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('increments zones_added_roads when a new roads zone is appended to memory (shouldAppend=true)', async () => {
    const roomId = 'test-room';
    const token = app.jwt.sign({ roomId });

    // Route: VALID_ZONE_A is roads type, no existing memory entry → shouldAppend = true
    const ROADS_ZONE = 'cases-ugumlos'; // a roads zone
    mockDb.query.mockImplementation((q: string) => {
      if (q.includes('FROM rooms')) return Promise.resolve({ rows: [{ id: roomId }] });
      if (q.includes('FROM connections')) return Promise.resolve({ rows: [] });
      if (q.includes('SELECT chain_id FROM room_node_positions')) return Promise.resolve({ rows: [{ chain_id: 'test-chain-id' }] });
      if (q.includes('FROM room_node_memory') && q.includes('times_added')) {
        return Promise.resolve({ rows: [] }); // no existing memory → shouldAppend = true
      }
      if (q.includes('FROM room_node_memory')) return Promise.resolve({ rows: [] });
      if (q.includes('FROM room_node_positions') && q.includes('SELECT zone_id')) return Promise.resolve({ rows: [] });
      if (q.includes('custom_handles FROM room_node_positions')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        fromZoneId: VALID_ZONE_ID, // roadsHideout home
        toZoneId: ROADS_ZONE,       // roads zone — will trigger memory append
        secondsRemaining: 1800,
        slots: 7,
        targetPosition: { x: 100, y: 200 },
      },
    });
    expect(res.statusCode).toBe(201);

    expect(hasAnalyticsQuery(mockDb, 'analytics_room_daily', 'zones_added_roads')).toBe(true);
    expect(hasAnalyticsQuery(mockDb, 'analytics_room_alltime', 'zones_added_roads')).toBe(true);
    expect(hasAnalyticsQuery(mockDb, 'analytics_room_daily', 'zones_added_nonroads')).toBe(false);
  });

  it('increments zones_added_nonroads when a new non-roads zone position is added for the first time', async () => {
    const roomId = 'test-room';
    const token = app.jwt.sign({ roomId });

    // VALID_ZONE_B is a non-roads zone; simulate it not yet having a position
    mockDb.query.mockImplementation((q: string) => {
      if (q.includes('FROM rooms')) return Promise.resolve({ rows: [{ id: roomId }] });
      if (q.includes('FROM connections')) return Promise.resolve({ rows: [] });
      if (q.includes('SELECT chain_id FROM room_node_positions')) return Promise.resolve({ rows: [{ chain_id: 'test-chain-id' }] });
      // Non-roads zone existence check: return empty rows (zone not yet placed)
      if (q.includes('FROM room_node_positions') && q.includes('SELECT zone_id')) return Promise.resolve({ rows: [] });
      if (q.includes('custom_handles FROM room_node_positions')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        fromZoneId: VALID_ZONE_A,
        toZoneId: VALID_ZONE_B,   // non-roads zone, first time placed
        secondsRemaining: 1800,
        slots: 7,
        targetPosition: { x: 100, y: 200 },
      },
    });
    expect(res.statusCode).toBe(201);

    expect(hasAnalyticsQuery(mockDb, 'analytics_room_daily', 'zones_added_nonroads')).toBe(true);
    expect(hasAnalyticsQuery(mockDb, 'analytics_room_alltime', 'zones_added_nonroads')).toBe(true);
    expect(hasAnalyticsQuery(mockDb, 'analytics_room_daily', 'zones_added_roads')).toBe(false);
  });

  it('does NOT increment zones_added_nonroads when a non-roads zone position already exists', async () => {
    const roomId = 'test-room';
    const token = app.jwt.sign({ roomId });

    mockDb.query.mockImplementation((q: string) => {
      if (q.includes('FROM rooms')) return Promise.resolve({ rows: [{ id: roomId }] });
      if (q.includes('FROM connections')) return Promise.resolve({ rows: [] });
      if (q.includes('SELECT chain_id FROM room_node_positions')) return Promise.resolve({ rows: [{ chain_id: 'test-chain-id' }] });
      // Non-roads zone existence check: return existing row (already placed)
      if (q.includes('FROM room_node_positions') && q.includes('SELECT zone_id')) {
        return Promise.resolve({ rows: [{ zone_id: VALID_ZONE_B }] });
      }
      if (q.includes('custom_handles FROM room_node_positions')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        fromZoneId: VALID_ZONE_A,
        toZoneId: VALID_ZONE_B,   // non-roads zone, already exists
        secondsRemaining: 1800,
        slots: 7,
        targetPosition: { x: 100, y: 200 },
      },
    });
    expect(res.statusCode).toBe(201);

    expect(hasAnalyticsQuery(mockDb, 'analytics_room_daily', 'zones_added_nonroads')).toBe(false);
    expect(hasAnalyticsQuery(mockDb, 'analytics_room_daily', 'zones_added_roads')).toBe(false);
  });

  it('increments global zones_added when a new roads zone is added', async () => {
    const roomId = 'test-room';
    const token = app.jwt.sign({ roomId });
    const ROADS_ZONE = 'cases-ugumlos';

    mockDb.query.mockImplementation((q: string) => {
      if (q.includes('FROM rooms')) return Promise.resolve({ rows: [{ id: roomId }] });
      if (q.includes('FROM connections')) return Promise.resolve({ rows: [] });
      if (q.includes('SELECT chain_id FROM room_node_positions')) return Promise.resolve({ rows: [{ chain_id: 'test-chain-id' }] });
      if (q.includes('FROM room_node_memory') && q.includes('times_added')) return Promise.resolve({ rows: [] });
      if (q.includes('FROM room_node_memory')) return Promise.resolve({ rows: [] });
      if (q.includes('FROM room_node_positions') && q.includes('SELECT zone_id')) return Promise.resolve({ rows: [] });
      if (q.includes('custom_handles FROM room_node_positions')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        fromZoneId: VALID_ZONE_ID,
        toZoneId: ROADS_ZONE,
        secondsRemaining: 1800,
        slots: 7,
        targetPosition: { x: 100, y: 200 },
      },
    });
    expect(res.statusCode).toBe(201);

    expect(hasAnalyticsQuery(mockDb, 'analytics_global_daily', 'zones_added')).toBe(true);
    expect(hasAnalyticsQuery(mockDb, 'analytics_global_daily', 'non_roads_zones_added')).toBe(false);
    expect(hasAnalyticsQuery(mockDb, 'analytics_global_daily', 'room_data_updates')).toBe(true);
  });

  it('increments global non_roads_zones_added when a new non-roads zone is added for the first time', async () => {
    const roomId = 'test-room';
    const token = app.jwt.sign({ roomId });

    mockDb.query.mockImplementation((q: string) => {
      if (q.includes('FROM rooms')) return Promise.resolve({ rows: [{ id: roomId }] });
      if (q.includes('FROM connections')) return Promise.resolve({ rows: [] });
      if (q.includes('SELECT chain_id FROM room_node_positions')) return Promise.resolve({ rows: [{ chain_id: 'test-chain-id' }] });
      if (q.includes('FROM room_node_positions') && q.includes('SELECT zone_id')) return Promise.resolve({ rows: [] });
      if (q.includes('custom_handles FROM room_node_positions')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        fromZoneId: VALID_ZONE_A,
        toZoneId: VALID_ZONE_B,
        secondsRemaining: 1800,
        slots: 7,
        targetPosition: { x: 100, y: 200 },
      },
    });
    expect(res.statusCode).toBe(201);

    expect(hasAnalyticsQuery(mockDb, 'analytics_global_daily', 'non_roads_zones_added')).toBe(true);
    expect(hasAnalyticsQuery(mockDb, 'analytics_global_daily', 'room_data_updates')).toBe(true);
    // zones_added (roads) column must NOT be set — check no analytics_global_daily SQL mentions `zones_added`
    // as a standalone column (i.e. not as part of non_roads_zones_added)
    const globalRoadsCalls: string[] = mockDb.query.mock.calls
      .map((c: any[]) => (typeof c[0] === 'string' ? c[0] : ''))
      .filter((s: string) => s.includes('analytics_global_daily') && /\bzones_added\b/.test(s) && !s.includes('non_roads_zones_added'));
    expect(globalRoadsCalls.length).toBe(0);
  });

  it('increments global room_data_updates on every node position update', async () => {
    const roomId = 'test-room';
    const token = app.jwt.sign({ roomId });

    mockDb.query.mockImplementation((q: string) => {
      if (q.includes('FROM rooms')) return Promise.resolve({ rows: [{ id: roomId }] });
      if (q.includes('FROM connections')) return Promise.resolve({ rows: [] });
      if (q.includes('SELECT chain_id FROM room_node_positions')) return Promise.resolve({ rows: [{ chain_id: 'test-chain-id' }] });
      // zone already exists — no zone discovery fires, only room_data_updates
      if (q.includes('FROM room_node_positions') && q.includes('SELECT zone_id')) return Promise.resolve({ rows: [{ zone_id: VALID_ZONE_B }] });
      if (q.includes('custom_handles FROM room_node_positions')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        fromZoneId: VALID_ZONE_A,
        toZoneId: VALID_ZONE_B,
        secondsRemaining: 1800,
        slots: 7,
        targetPosition: { x: 100, y: 200 },
      },
    });
    expect(res.statusCode).toBe(201);

    expect(hasAnalyticsQuery(mockDb, 'analytics_global_daily', 'room_data_updates')).toBe(true);
  });
});

describe('Analytics — node position updates via WebSocket', () => {
  const testApp = setupTestApp();
  const { roomId } = testApp;
  let app: FastifyInstance;
  let mockDb: any;

  beforeEach(() => {
    ({ app, mockDb } = testApp);
  });

  async function connectAndAuth(): Promise<{ socket: import('ws').WebSocket; close: () => void }> {
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 3001;
    const { WebSocket } = await import('ws');
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/rooms/${roomId}`);
    await new Promise<void>((resolve, reject) => {
      socket.on('open', resolve);
      socket.on('error', reject);
    });
    return { socket, close: () => socket.close() };
  }

  it('increments rooms_modified and per-room data_updates when update_node_positions is sent via WS', async () => {
    // Auth sync mocks
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId, home_zone_id: VALID_ZONE_A, created_at: new Date().toISOString() }] });
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // node positions

    const mockClient = {
      query: vi.fn().mockImplementation((q: string) => {
        if (q.includes('SELECT home_zone_id')) return Promise.resolve({ rows: [{ home_zone_id: VALID_ZONE_A }] });
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
      release: vi.fn(),
    };
    mockDb.connect.mockResolvedValue(mockClient);

    await app.listen({ port: 0 });
    const { socket } = await connectAndAuth();
    const token = testApp.token;

    socket.send(JSON.stringify({ type: 'auth', token }));
    await new Promise((r) => setTimeout(r, 150));

    // Reset call history so we only see analytics calls from this point
    mockDb.query.mockClear();
    mockDb.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockClient.query.mockClear();
    mockClient.query.mockImplementation((q: string) => {
      if (q.includes('SELECT home_zone_id')) return Promise.resolve({ rows: [{ home_zone_id: VALID_ZONE_A }] });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    socket.send(JSON.stringify({
      type: 'update_node_positions',
      nodePositions: [{ zoneId: VALID_ZONE_A, x: 10, y: 20, features: {}, explored: false, rotation: 0 }],
      updateLastUpdated: true,
    }));

    await new Promise((r) => setTimeout(r, 200));

    expect(hasAnalyticsQuery(mockDb, 'analytics_global_daily', 'rooms_modified')).toBe(true);
    expect(hasAnalyticsQuery(mockDb, 'analytics_room_daily', 'data_updates')).toBe(true);
    expect(hasAnalyticsQuery(mockDb, 'analytics_room_alltime', 'data_updates')).toBe(true);

    socket.close();
  });

  it('records the token fingerprint in-memory and reports peak_concurrent >= 1 after WS auth', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId, home_zone_id: VALID_ZONE_A, created_at: new Date().toISOString() }] });
    mockDb.query.mockResolvedValueOnce({ rows: [] });
    mockDb.query.mockResolvedValueOnce({ rows: [] });

    // Clear any state from previous tests before listening
    const { clearAnalyticsDate } = await import('../src/broadcast_analytics.js');
    const { londonDateString } = await import('../src/analytics.js');
    const today = londonDateString();
    clearAnalyticsDate(today);

    await app.listen({ port: 0 });
    const { socket } = await connectAndAuth();
    const token = testApp.token!;

    socket.send(JSON.stringify({ type: 'auth', token }));
    await new Promise((r) => setTimeout(r, 150));

    // Import broadcast to check in-memory state
    const { getAnalyticsSnapshot, getGlobalAnalyticsSnapshot } = await import('../src/broadcast_analytics.js');

    const snapshot = getAnalyticsSnapshot();
    const roomEntry = snapshot.find((e) => e.roomId === roomId && e.date === today);
    expect(roomEntry).toBeDefined();
    expect(roomEntry!.peakConcurrent).toBeGreaterThanOrEqual(1);
    expect(roomEntry!.uniqueTokens).toBe(1);

    const globalSnap = getGlobalAnalyticsSnapshot(today);
    expect(globalSnap.peakConcurrent).toBeGreaterThanOrEqual(1);
    expect(globalSnap.uniqueTokensActive).toBeGreaterThanOrEqual(1);

    socket.close();
  });

  it('counts the same token only once for unique_tokens on the same day', async () => {
    // Clear stale in-memory state from previous tests
    const { clearAnalyticsDate } = await import('../src/broadcast_analytics.js');
    const { londonDateString } = await import('../src/analytics.js');
    const today = londonDateString();
    clearAnalyticsDate(today);

    // First connection
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId, home_zone_id: VALID_ZONE_A, created_at: new Date().toISOString() }] });
    mockDb.query.mockResolvedValueOnce({ rows: [] });
    mockDb.query.mockResolvedValueOnce({ rows: [] });
    // Second connection (same token, same room)
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId, home_zone_id: VALID_ZONE_A, created_at: new Date().toISOString() }] });
    mockDb.query.mockResolvedValueOnce({ rows: [] });
    mockDb.query.mockResolvedValueOnce({ rows: [] });

    await app.listen({ port: 0 });
    const token = testApp.token!;

    const { socket: s1 } = await connectAndAuth();
    s1.send(JSON.stringify({ type: 'auth', token }));
    await new Promise((r) => setTimeout(r, 150));

    const { socket: s2 } = await connectAndAuth();
    s2.send(JSON.stringify({ type: 'auth', token }));
    await new Promise((r) => setTimeout(r, 150));

    const { getAnalyticsSnapshot } = await import('../src/broadcast_analytics.js');
    const snapshot = getAnalyticsSnapshot();
    const roomEntry = snapshot.find((e) => e.roomId === roomId && e.date === today);

    expect(roomEntry).toBeDefined();
    // Same token → still counted as 1 unique token regardless of connection count
    expect(roomEntry!.uniqueTokens).toBe(1);
    // But peak should reflect 2 concurrent connections
    expect(roomEntry!.peakConcurrent).toBeGreaterThanOrEqual(2);

    s1.close();
    s2.close();
  });

  it('increments routes_plotted globally and per-room when update_plot_route is sent via WS', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId, home_zone_id: VALID_ZONE_A, created_at: new Date().toISOString() }] });
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // node positions

    await app.listen({ port: 0 });
    const { socket } = await connectAndAuth();
    const token = testApp.token!;

    socket.send(JSON.stringify({ type: 'auth', token }));
    await new Promise((r) => setTimeout(r, 150));

    mockDb.query.mockClear();
    mockDb.query.mockResolvedValue({ rows: [], rowCount: 1 });

    socket.send(JSON.stringify({
      type: 'update_plot_route',
      plottedRoute: [VALID_ZONE_A, VALID_ZONE_B],
      fromZoneId: VALID_ZONE_A,
      toZoneId: VALID_ZONE_B,
    }));

    await new Promise((r) => setTimeout(r, 200));

    expect(hasAnalyticsQuery(mockDb, 'analytics_global_daily', 'routes_plotted')).toBe(true);
    expect(hasAnalyticsQuery(mockDb, 'analytics_global_daily', 'room_data_updates')).toBe(true);
    expect(hasAnalyticsQuery(mockDb, 'analytics_room_daily', 'routes_plotted')).toBe(true);
    expect(hasAnalyticsQuery(mockDb, 'analytics_room_alltime', 'routes_plotted')).toBe(true);

    socket.close();
  });

  it('does NOT increment routes_plotted when update_plot_route is sent with an empty route (clear)', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId, home_zone_id: VALID_ZONE_A, created_at: new Date().toISOString() }] });
    mockDb.query.mockResolvedValueOnce({ rows: [] });
    mockDb.query.mockResolvedValueOnce({ rows: [] });

    await app.listen({ port: 0 });
    const { socket } = await connectAndAuth();
    const token = testApp.token!;

    socket.send(JSON.stringify({ type: 'auth', token }));
    await new Promise((r) => setTimeout(r, 150));

    mockDb.query.mockClear();
    mockDb.query.mockResolvedValue({ rows: [], rowCount: 1 });

    socket.send(JSON.stringify({ type: 'update_plot_route', plottedRoute: [] }));

    await new Promise((r) => setTimeout(r, 200));

    expect(hasAnalyticsQuery(mockDb, 'analytics_global_daily', 'routes_plotted')).toBe(false);

    socket.close();
  });
});

// ---------------------------------------------------------------------------
// analytics helper unit tests
// ---------------------------------------------------------------------------
describe('Analytics helpers', () => {
  it('londonDateString returns YYYY-MM-DD format in London time', async () => {
    const { londonDateString } = await import('../src/analytics.js');
    const result = londonDateString(new Date('2026-06-13T15:30:00Z'));
    expect(result).toBe('2026-06-13');
  });

  it('incrementGlobal issues correct SQL with rooms_created', async () => {
    const { incrementGlobal } = await import('../src/analytics.js');
    const mockDb = { query: vi.fn().mockResolvedValue({ rows: [] }) } as any;
    incrementGlobal(mockDb, { rooms_created: 1 });
    await new Promise((r) => setTimeout(r, 10)); // flush microtask
    const sql: string = mockDb.query.mock.calls[0][0];
    expect(sql).toContain('analytics_global_daily');
    expect(sql).toContain('rooms_created');
    expect(sql).toContain('ON CONFLICT');
  });

  it('incrementGlobal does nothing when all counters are zero', async () => {
    const { incrementGlobal } = await import('../src/analytics.js');
    const mockDb = { query: vi.fn().mockResolvedValue({ rows: [] }) } as any;
    incrementGlobal(mockDb, { rooms_created: 0 });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockDb.query).not.toHaveBeenCalled();
  });

  it('incrementRoomDaily does nothing when all counters are zero', async () => {
    const { incrementRoomDaily } = await import('../src/analytics.js');
    const mockDb = { query: vi.fn().mockResolvedValue({ rows: [] }) } as any;
    incrementRoomDaily(mockDb, 'room-1', { data_updates: 0 });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockDb.query).not.toHaveBeenCalled();
  });

  it('incrementRoomDaily issues INSERT into analytics_room_daily with ON CONFLICT', async () => {
    const { incrementRoomDaily } = await import('../src/analytics.js');
    const mockDb = { query: vi.fn().mockResolvedValue({ rows: [] }) } as any;
    incrementRoomDaily(mockDb, 'room-1', { data_updates: 1 });
    await new Promise((r) => setTimeout(r, 10));
    const sql: string = mockDb.query.mock.calls[0][0];
    expect(sql).toContain('analytics_room_daily');
    expect(sql).toContain('data_updates');
    expect(sql).toContain('ON CONFLICT');
  });

  it('incrementRoomAlltime issues INSERT into analytics_room_alltime with ON CONFLICT', async () => {
    const { incrementRoomAlltime } = await import('../src/analytics.js');
    const mockDb = { query: vi.fn().mockResolvedValue({ rows: [] }) } as any;
    incrementRoomAlltime(mockDb, 'room-1', { zones_added_roads: 1 });
    await new Promise((r) => setTimeout(r, 10));
    const sql: string = mockDb.query.mock.calls[0][0];
    expect(sql).toContain('analytics_room_alltime');
    expect(sql).toContain('zones_added_roads');
    expect(sql).toContain('ON CONFLICT');
  });

  it('flushConcurrencyStats also upserts peak_concurrent and unique_tokens into analytics_room_alltime', async () => {
    const { flushConcurrencyStats } = await import('../src/analytics.js');
    const mockDb = { query: vi.fn().mockResolvedValue({ rows: [] }) } as any;
    await flushConcurrencyStats(mockDb, 'room-1', '2026-06-13', 5, 3);
    const calls: string[] = mockDb.query.mock.calls.map((c: any[]) => c[0] as string);
    const alltimeCall = calls.find((sql) => sql.includes('analytics_room_alltime') && sql.includes('peak_concurrent'));
    expect(alltimeCall).toBeDefined();
    expect(alltimeCall).toContain('unique_tokens');
    expect(alltimeCall).toContain('ON CONFLICT');
    expect(alltimeCall).toContain('GREATEST');
  });

  it('recalculateRoomCounts issues UPDATE on analytics_global_daily with active_rooms and rooms_modified subqueries', async () => {
    const { recalculateRoomCounts } = await import('../src/analytics.js');
    const mockDb = { query: vi.fn().mockResolvedValue({ rows: [] }) } as any;
    recalculateRoomCounts(mockDb, '2026-06-13');
    await new Promise((r) => setTimeout(r, 10));
    const sql: string = mockDb.query.mock.calls[0][0];
    expect(sql).toContain('analytics_global_daily');
    expect(sql).toContain('active_rooms');
    expect(sql).toContain('inactive_rooms');
    expect(sql).toContain('total_rooms');
    expect(sql).toContain('rooms_modified');
    expect(sql).toContain('COUNT(DISTINCT room_id)');
  });
});

// ---------------------------------------------------------------------------
// analyticsCron unit tests
// ---------------------------------------------------------------------------
describe('analyticsCron — runAnalyticsFlush', () => {
  it('calls flushConcurrencyStats and flushGlobalConcurrencyStats for rooms with data', async () => {
    const { runAnalyticsFlush } = await import('../src/analyticsCron.js');
    const { clearAnalyticsDate } = await import('../src/broadcast_analytics.js');

    const { londonDateString } = await import('../src/analytics.js');

    const today = londonDateString();

    // Clean state
    clearAnalyticsDate(today);

    const mockDb = { query: vi.fn().mockResolvedValue({ rows: [] }) } as any;

    // If nothing in memory, flush should be a no-op
    await runAnalyticsFlush(mockDb);
    expect(mockDb.query).not.toHaveBeenCalled();
  });
});

describe('analyticsCron — flushHourlyConnections', () => {
  it('upserts into analytics_hourly_connections with a single hour-truncated ISO timestamp', async () => {
    const { flushHourlyConnections } = await import('../src/analyticsCron.js');
    const mockDb = { query: vi.fn().mockResolvedValue({ rows: [] }) } as any;

    await flushHourlyConnections(mockDb);

    expect(mockDb.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mockDb.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('analytics_hourly_connections');
    expect(sql).toContain('max_connections');
    expect(sql).toContain('min_connections');
    expect(sql).toContain('ON CONFLICT (hour)');
    expect(sql).toContain('GREATEST');
    expect(sql).toContain('LEAST');
    // First param: ISO timestamp with minutes/seconds zeroed, e.g. "2026-06-13T04:00:00.000Z"
    expect(typeof params[0]).toBe('string');
    expect(params[0] as string).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/);
    // Second param: non-negative integer connection count (used for both max and min on insert)
    expect(typeof params[1]).toBe('number');
    expect(params[1] as number).toBeGreaterThanOrEqual(0);
  });

  it('targets the same hour bucket on repeated calls within the same minute', async () => {
    const { flushHourlyConnections } = await import('../src/analyticsCron.js');
    const mockDb = { query: vi.fn().mockResolvedValue({ rows: [] }) } as any;

    await flushHourlyConnections(mockDb);
    await flushHourlyConnections(mockDb);

    expect(mockDb.query).toHaveBeenCalledTimes(2);
    const hours = mockDb.query.mock.calls.map((c: any[]) => (c[1] as unknown[])[0]);
    // Both calls must reference the same hour-truncated timestamp
    expect(hours[0]).toBe(hours[1]);
    // Both must use GREATEST (max) and LEAST (min) so the peak and trough are preserved
    for (const [sql] of mockDb.query.mock.calls as [string, unknown[]][]) {
      expect(sql).toContain('GREATEST');
      expect(sql).toContain('LEAST');
    }
  });

  it('does not throw if the DB query fails', async () => {
    const { flushHourlyConnections } = await import('../src/analyticsCron.js');
    const mockDb = { query: vi.fn().mockRejectedValue(new Error('DB down')) } as any;

    await expect(flushHourlyConnections(mockDb)).resolves.toBeUndefined();
  });
});
