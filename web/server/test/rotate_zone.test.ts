/**
 * Integration tests for the rotate_zone WebSocket endpoint.
 *
 * These tests create a map with bad / desynced rotation data in the DB and
 * then send a rotate_zone message over a real WebSocket connection.  They
 * verify that:
 *   1. The server canonicalises the handles for the requested rotation.
 *   2. The corrected node_positions_updated broadcast is sent to all clients.
 *   3. The DB UPDATE is called with the canonical handles (not the bad ones).
 *   4. The server self-heals when the stored handles are at a different
 *      rotation than the stored rotation field (classic desync scenario).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupTestApp } from './testApp.js';
import type { FastifyInstance } from 'fastify';
import { getShapeHandlePositions, canonicalizeHandlesForRotation } from 'shared';

// A roads zone that has mapShape = 'c' — confirmed present in the zone DB.
const ROADS_ZONE = 'cases-ugumlos';
const SHAPE = 'c';

const testApp = setupTestApp();
let app: FastifyInstance;
let mockDb: any;
let token: string;
const { roomId } = testApp;

beforeEach(() => {
  ({ app, mockDb, token } = testApp);
});

// ─── helpers ─────────────────────────────────────────────────────────────────

async function connectWs(roomIdParam: string) {
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 3001;
  const { WebSocket } = await import('ws');
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/rooms/${roomIdParam}`);
  await new Promise<void>((resolve, reject) => {
    socket.on('open', resolve);
    socket.on('error', reject);
  });
  return { socket, close: () => socket.close() };
}

function collectMessages(socket: import('ws').WebSocket) {
  const messages: unknown[] = [];
  socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
  return messages;
}

/** Standard 4-query auth/sync mock (room, chains, connections, node positions). */
function mockAuthSync(existingPositionRow?: object) {
  mockDb.query.mockResolvedValueOnce({
    rows: [{ id: roomId, home_zone_id: ROADS_ZONE, created_at: new Date().toISOString(), chain_migrated: true }],
  }); // room
  mockDb.query.mockResolvedValueOnce({ rows: [{ id: 'chain-1', source_zone_id: ROADS_ZONE }] }); // chains
  mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections
  mockDb.query.mockResolvedValueOnce({
    rows: existingPositionRow ? [existingPositionRow] : [],
  }); // node positions
  mockDb.query.mockResolvedValueOnce({ rows: [] }); // memory
}

/**
 * Build a transactional mockClient whose query responses match what
 * rotate_zone.ts expects:
 *   BEGIN / SELECT home_zone_id FOR UPDATE / SELECT existing row / UPDATE / UPDATE rooms / COMMIT
 */
function makeRotateClient(existingRow: {
  zone_id: string;
  x: number;
  y: number;
  features: object;
  custom_handles: object | null;
  rotation: number;
  explored: boolean;
  chain_id: string | null;
}) {
  return {
    query: vi.fn().mockImplementation((q: string) => {
      if (q.includes('SELECT home_zone_id FROM rooms'))
        return Promise.resolve({ rows: [{ home_zone_id: ROADS_ZONE }] });
      if (q.includes('SELECT zone_id, x, y, features, custom_handles'))
        return Promise.resolve({ rows: [existingRow] });
      // BEGIN / COMMIT / ROLLBACK / UPDATE statements
      return Promise.resolve({ rows: [], rowCount: 1 });
    }),
    release: vi.fn(),
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('rotate_zone: basic rotation', () => {
  it('broadcasts node_positions_updated with canonical handles after a valid rotate_zone message', async () => {
    const defaults = getShapeHandlePositions(SHAPE);

    // DB has the zone at rotation 0 with default handles.
    const existingRow = {
      zone_id: ROADS_ZONE,
      x: 0,
      y: 0,
      features: {},
      custom_handles: defaults,
      rotation: 0,
      explored: true,
      chain_id: 'chain-1',
    };

    mockAuthSync(existingRow);
    const mockClient = makeRotateClient(existingRow);
    mockDb.connect.mockResolvedValue(mockClient);

    await app.listen({ port: 0 });
    const { socket } = await connectWs(roomId);
    const messages = collectMessages(socket);

    socket.send(JSON.stringify({ type: 'auth', token }));
    await new Promise((r) => setTimeout(r, 200));

    // Request rotation to step 1.
    socket.send(JSON.stringify({ type: 'rotate_zone', zoneId: ROADS_ZONE, rotation: 1 }));
    await new Promise((r) => setTimeout(r, 200));

    const update = messages.find((m) => (m as any).type === 'node_positions_updated') as any;
    expect(update).toBeDefined();
    expect(update.nodePositions).toHaveLength(1);

    const pos = update.nodePositions[0];
    expect(pos.zoneId).toBe(ROADS_ZONE);
    expect(pos.rotation).toBe(1);

    // The broadcast handles must match what canonicalizeHandlesForRotation produces.
    const expected = canonicalizeHandlesForRotation('roads', SHAPE, defaults, 1);
    expect(pos.customHandles).toEqual(expected);

    socket.close();
  });

  it('stores the canonical handles in the DB UPDATE call', async () => {
    const defaults = getShapeHandlePositions(SHAPE);
    const existingRow = {
      zone_id: ROADS_ZONE,
      x: 10,
      y: -5,
      features: {},
      custom_handles: defaults,
      rotation: 0,
      explored: false,
      chain_id: 'chain-1',
    };

    mockAuthSync(existingRow);
    const mockClient = makeRotateClient(existingRow);
    mockDb.connect.mockResolvedValue(mockClient);

    await app.listen({ port: 0 });
    const { socket } = await connectWs(roomId);

    socket.send(JSON.stringify({ type: 'auth', token }));
    await new Promise((r) => setTimeout(r, 200));

    socket.send(JSON.stringify({ type: 'rotate_zone', zoneId: ROADS_ZONE, rotation: 2 }));
    await new Promise((r) => setTimeout(r, 200));

    // Find the UPDATE room_node_positions call.
    const updateCall = mockClient.query.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('UPDATE room_node_positions SET rotation'),
    );
    expect(updateCall).toBeDefined();

    const params = updateCall![1] as any[];
    // Params: [roomId, zoneId, targetRotation, JSON.stringify(canonicalHandles)]
    expect(params[0]).toBe(roomId);
    expect(params[1]).toBe(ROADS_ZONE);
    expect(params[2]).toBe(2);

    const storedHandles = JSON.parse(params[3]);
    const expected = canonicalizeHandlesForRotation('roads', SHAPE, defaults, 2);
    expect(storedHandles).toEqual(expected);

    socket.close();
  });
});

describe('rotate_zone: self-heal desynced rotation', () => {
  it('corrects handles that are at rotation 1 but stored rotation field says 0 — rotate to 2', async () => {
    const defaults = getShapeHandlePositions(SHAPE);
    // Simulate desync: handles are physically at rotation 1 but stored rotation = 0.
    const desynced_handles = canonicalizeHandlesForRotation('roads', SHAPE, defaults, 1);

    const existingRow = {
      zone_id: ROADS_ZONE,
      x: 0,
      y: 0,
      features: {},
      custom_handles: desynced_handles,
      rotation: 0, // ← wrong: doesn't match the handle layout
      explored: true,
      chain_id: 'chain-1',
    };

    mockAuthSync(existingRow);
    const mockClient = makeRotateClient(existingRow);
    mockDb.connect.mockResolvedValue(mockClient);

    await app.listen({ port: 0 });
    const { socket } = await connectWs(roomId);
    const messages = collectMessages(socket);

    socket.send(JSON.stringify({ type: 'auth', token }));
    await new Promise((r) => setTimeout(r, 200));

    // Client requests rotation 2 — server must canonicalise from the *current*
    // handle layout (rotation 1) to the target (rotation 2), not from rotation 0.
    socket.send(JSON.stringify({ type: 'rotate_zone', zoneId: ROADS_ZONE, rotation: 2 }));
    await new Promise((r) => setTimeout(r, 200));

    const update = messages.find((m) => (m as any).type === 'node_positions_updated') as any;
    expect(update).toBeDefined();

    const pos = update.nodePositions[0];
    expect(pos.rotation).toBe(2);

    // The canonical handles for rotation 2 must be correct regardless of the
    // desynced stored rotation field.
    const expected = canonicalizeHandlesForRotation('roads', SHAPE, desynced_handles, 2);
    expect(pos.customHandles).toEqual(expected);

    socket.close();
  });

  it('resets a zone that has stored rotation=2 but no handles (partial reset desync) back to rotation 0', async () => {
    // Simulate a partial reset: handles were wiped but rotation field was not.
    const existingRow = {
      zone_id: ROADS_ZONE,
      x: 0,
      y: 0,
      features: {},
      custom_handles: null, // ← handles wiped
      rotation: 2,          // ← rotation not wiped — desync
      explored: true,
      chain_id: 'chain-1',
    };

    mockAuthSync(existingRow);
    const mockClient = makeRotateClient(existingRow);
    mockDb.connect.mockResolvedValue(mockClient);

    await app.listen({ port: 0 });
    const { socket } = await connectWs(roomId);
    const messages = collectMessages(socket);

    socket.send(JSON.stringify({ type: 'auth', token }));
    await new Promise((r) => setTimeout(r, 200));

    // User clicks the hourglass reset → sends rotate_zone with rotation 0.
    socket.send(JSON.stringify({ type: 'rotate_zone', zoneId: ROADS_ZONE, rotation: 0 }));
    await new Promise((r) => setTimeout(r, 200));

    const update = messages.find((m) => (m as any).type === 'node_positions_updated') as any;
    expect(update).toBeDefined();

    const pos = update.nodePositions[0];
    expect(pos.rotation).toBe(0);
    // Rotation 0 with null/empty incoming handles → canonical result is empty → stored as null.
    expect(pos.customHandles == null || pos.customHandles.length === 0).toBe(true);

    socket.close();
  });

  it('corrects handles that are at rotation 3 but stored rotation says 1 — reset to 0', async () => {
    const defaults = getShapeHandlePositions(SHAPE);
    const desynced_handles = canonicalizeHandlesForRotation('roads', SHAPE, defaults, 3);

    const existingRow = {
      zone_id: ROADS_ZONE,
      x: 5,
      y: 5,
      features: {},
      custom_handles: desynced_handles,
      rotation: 1, // ← wrong
      explored: true,
      chain_id: 'chain-1',
    };

    mockAuthSync(existingRow);
    const mockClient = makeRotateClient(existingRow);
    mockDb.connect.mockResolvedValue(mockClient);

    await app.listen({ port: 0 });
    const { socket } = await connectWs(roomId);
    const messages = collectMessages(socket);

    socket.send(JSON.stringify({ type: 'auth', token }));
    await new Promise((r) => setTimeout(r, 200));

    socket.send(JSON.stringify({ type: 'rotate_zone', zoneId: ROADS_ZONE, rotation: 0 }));
    await new Promise((r) => setTimeout(r, 200));

    const update = messages.find((m) => (m as any).type === 'node_positions_updated') as any;
    expect(update).toBeDefined();

    const pos = update.nodePositions[0];
    expect(pos.rotation).toBe(0);

    // canonicalizeHandlesForRotation from the desynced handles (rot 3) to target 0
    // should produce the default positions.
    const expected = canonicalizeHandlesForRotation('roads', SHAPE, desynced_handles, 0);
    expect(pos.customHandles).toEqual(expected);

    socket.close();
  });
});

describe('rotate_zone: out-of-range and edge cases', () => {
  it('normalises rotation step 5 to 1 and applies it correctly', async () => {
    const defaults = getShapeHandlePositions(SHAPE);
    const existingRow = {
      zone_id: ROADS_ZONE,
      x: 0,
      y: 0,
      features: {},
      custom_handles: defaults,
      rotation: 0,
      explored: true,
      chain_id: 'chain-1',
    };

    mockAuthSync(existingRow);
    const mockClient = makeRotateClient(existingRow);
    mockDb.connect.mockResolvedValue(mockClient);

    await app.listen({ port: 0 });
    const { socket } = await connectWs(roomId);
    const messages = collectMessages(socket);

    socket.send(JSON.stringify({ type: 'auth', token }));
    await new Promise((r) => setTimeout(r, 200));

    // Step 5 should normalise to 1.
    socket.send(JSON.stringify({ type: 'rotate_zone', zoneId: ROADS_ZONE, rotation: 5 }));
    await new Promise((r) => setTimeout(r, 200));

    const update = messages.find((m) => (m as any).type === 'node_positions_updated') as any;
    expect(update).toBeDefined();
    expect(update.nodePositions[0].rotation).toBe(1);

    const expected = canonicalizeHandlesForRotation('roads', SHAPE, defaults, 1);
    expect(update.nodePositions[0].customHandles).toEqual(expected);

    socket.close();
  });

  it('does not broadcast when the zone does not exist in the DB', async () => {
    mockAuthSync();
    // Transactional client: SELECT existing returns no rows → handler rolls back and returns.
    const mockClient = {
      query: vi.fn().mockImplementation((q: string) => {
        if (q.includes('SELECT home_zone_id FROM rooms'))
          return Promise.resolve({ rows: [{ home_zone_id: ROADS_ZONE }] });
        if (q.includes('SELECT zone_id, x, y, features, custom_handles'))
          return Promise.resolve({ rows: [] }); // zone not in DB
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
      release: vi.fn(),
    };
    mockDb.connect.mockResolvedValue(mockClient);

    await app.listen({ port: 0 });
    const { socket } = await connectWs(roomId);
    const messages = collectMessages(socket);

    socket.send(JSON.stringify({ type: 'auth', token }));
    await new Promise((r) => setTimeout(r, 200));

    const countBefore = messages.filter((m) => (m as any).type === 'node_positions_updated').length;

    socket.send(JSON.stringify({ type: 'rotate_zone', zoneId: ROADS_ZONE, rotation: 1 }));
    await new Promise((r) => setTimeout(r, 200));

    const countAfter = messages.filter((m) => (m as any).type === 'node_positions_updated').length;
    expect(countAfter).toBe(countBefore); // no new broadcast

    socket.close();
  });

  it('round-trips all four rotation steps and each broadcast carries the correct canonical handles', async () => {
    const defaults = getShapeHandlePositions(SHAPE);

    // Build a mockClient whose query fn tracks the "current" existing row so
    // each rotate_zone call sees the handles that the previous step produced.
    let currentHandles: any[] = [...defaults];
    let currentRotation = 0;

    const mockClient = {
      query: vi.fn().mockImplementation((q: string) => {
        if (q.includes('SELECT home_zone_id FROM rooms'))
          return Promise.resolve({ rows: [{ home_zone_id: ROADS_ZONE }] });
        if (q.includes('SELECT zone_id, x, y, features, custom_handles'))
          return Promise.resolve({
            rows: [{
              zone_id: ROADS_ZONE, x: 0, y: 0, features: {},
              custom_handles: currentHandles,
              rotation: currentRotation,
              explored: true, chain_id: 'chain-1',
            }],
          });
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };

    // Auth/sync only needs to be mocked once — we use a single connection.
    mockAuthSync({ zone_id: ROADS_ZONE, x: 0, y: 0, features: {}, custom_handles: defaults, rotation: 0, explored: true });
    mockDb.connect.mockResolvedValue(mockClient);

    await app.listen({ port: 0 });
    const { socket } = await connectWs(roomId);
    const messages: unknown[] = [];
    socket.on('message', (data) => messages.push(JSON.parse(data.toString())));

    socket.send(JSON.stringify({ type: 'auth', token }));
    await new Promise((r) => setTimeout(r, 200));

    // Rotate through steps 1 → 2 → 3 → 0 on the same connection.
    for (let targetStep = 1; targetStep <= 4; targetStep++) {
      const target = targetStep % 4;
      const prevHandles = [...currentHandles];

      messages.length = 0; // clear so we can find the next broadcast cleanly

      socket.send(JSON.stringify({ type: 'rotate_zone', zoneId: ROADS_ZONE, rotation: target }));
      await new Promise((r) => setTimeout(r, 200));

      const update = messages.find((m) => (m as any).type === 'node_positions_updated') as any;
      expect(update).toBeDefined();

      const pos = update.nodePositions[0];
      expect(pos.rotation).toBe(target);

      const expected = canonicalizeHandlesForRotation('roads', SHAPE, prevHandles, target);
      expect(pos.customHandles).toEqual(expected);

      // Advance state so the next mockClient call returns the updated handles.
      currentHandles = expected ?? [];
      currentRotation = target;
    }

    socket.close();
  });
});
