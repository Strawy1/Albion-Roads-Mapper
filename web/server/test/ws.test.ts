import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { setupTestApp } from './testApp.js';
import type { FastifyInstance } from 'fastify';

/** Build a HS256 JWT whose `exp` is set in the past so it is already expired. */
function makeExpiredToken(secret: string, roomId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({ roomId, iat: nowSec - 7200, exp: nowSec - 3600 }),
  ).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const signature = createHmac('sha256', secret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

const VALID_ZONE_A = 'adrens-hill';
const VALID_ZONE_B = 'anklesnag-mire';

const testApp = setupTestApp();
const { roomId } = testApp;
let app: FastifyInstance;
let mockDb: any;
let token: string;

beforeEach(() => {
  ({ app, mockDb, token } = testApp);
});

function waitForMessage(ws: Awaited<ReturnType<typeof connectWs>>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    ws.socket.once('message', (data) => {
      try {
        resolve(JSON.parse(data.toString()));
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function connectWs(roomIdParam: string): Promise<{ socket: import('ws').WebSocket; close: () => void }> {
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

describe('WebSocket authentication', () => {
  it('closes with code 4401 when invalid token is provided immediately', async () => {
    await app.listen({ port: 0 });

    const { socket } = await connectWs(roomId);

    const closeCode = await new Promise<number>((resolve) => {
      socket.on('close', (code) => resolve(code));
      // Send a token that is structurally valid JWT but signed with wrong secret
      socket.send(JSON.stringify({ type: 'auth', token: 'bad.token.value' }));
    });

    expect(closeCode).toBe(4401);
  });

  it('responds with auth_ok when valid token is sent', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId, home_zone_id: VALID_ZONE_A, created_at: new Date().toISOString(), chain_migrated: true }] }); // room
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: 'test-chain-id', source_zone_id: VALID_ZONE_A }] }); // chains
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // node positions

    await app.listen({ port: 0 });

    const { socket } = await connectWs(roomId);
    const msgPromise = waitForMessage({ socket } as Awaited<ReturnType<typeof connectWs>>);

    socket.send(JSON.stringify({ type: 'auth', token }));

    const msg = await msgPromise;
    expect((msg as { type: string }).type).toBe('auth_ok');

    socket.close();
  });

  it('replies with polo to a client-initiated marco (liveness probe)', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId, home_zone_id: VALID_ZONE_A, created_at: new Date().toISOString(), chain_migrated: true }] }); // room
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: 'test-chain-id', source_zone_id: VALID_ZONE_A }] }); // chains
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // node positions

    await app.listen({ port: 0 });

    const { socket } = await connectWs(roomId);

    // Drain auth_ok + sync + memory_sync, then send marco and await the polo.
    const poloPromise = new Promise<unknown>((resolve) => {
      socket.on('message', (data) => {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === 'polo') resolve(parsed);
      });
    });

    socket.send(JSON.stringify({ type: 'auth', token }));
    await new Promise((r) => setTimeout(r, 200)); // wait for auth_ok + sync
    socket.send(JSON.stringify({ type: 'marco' }));

    const polo = await poloPromise;
    expect((polo as { type: string }).type).toBe('polo');

    socket.close();
  });

  it('sends sync message after auth_ok', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId, home_zone_id: VALID_ZONE_A, created_at: new Date().toISOString(), chain_migrated: true }] }); // room
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: 'test-chain-id', source_zone_id: VALID_ZONE_A }] }); // chains
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // node positions

    await app.listen({ port: 0 });

    const { socket } = await connectWs(roomId);
    const messages: unknown[] = [];

    // Collect first two messages
    const collect = new Promise<void>((resolve) => {
      let count = 0;
      socket.on('message', (data) => {
        messages.push(JSON.parse(data.toString()));
        count++;
        if (count >= 2) resolve();
      });
    });

    socket.send(JSON.stringify({ type: 'auth', token }));
    await collect;

    expect((messages[0] as { type: string }).type).toBe('auth_ok');
    expect((messages[1] as { type: string; connections: unknown[]; homeZoneId: string }).type).toBe('sync');
    expect(Array.isArray((messages[1] as { connections: unknown[] }).connections)).toBe(true);

    socket.close();
  });

  it('closes with 4401 when invalid token is sent', async () => {
    await app.listen({ port: 0 });

    const { socket } = await connectWs(roomId);

    const closeCode = await new Promise<number>((resolve) => {
      socket.on('close', (code) => resolve(code));
      socket.send(JSON.stringify({ type: 'auth', token: 'invalid.token.here' }));
    });

    expect(closeCode).toBe(4401);
  });

  it('only fans out to clients in the same room', async () => {
    // room 1 sync mocks (room, connections, node positions, memory)
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId, home_zone_id: VALID_ZONE_A, created_at: new Date().toISOString(), chain_migrated: true }] });
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: 'test-chain-id', source_zone_id: VALID_ZONE_A }] }); // chains
    mockDb.query.mockResolvedValueOnce({ rows: [] });
    mockDb.query.mockResolvedValueOnce({ rows: [] });
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // memory sync

    await app.listen({ port: 0 });

    // Create a second room
    const roomId2 = 'room-2';
    const token1 = app.jwt.sign({ roomId });
    const token2 = app.jwt.sign({ roomId: roomId2 });

    // room 2 sync mocks (room, chains, connections, node positions, memory)
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId2, home_zone_id: VALID_ZONE_B, created_at: new Date().toISOString(), chain_migrated: true }] });
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: 'chain-2', source_zone_id: VALID_ZONE_B }] }); // chains
    mockDb.query.mockResolvedValueOnce({ rows: [] });
    mockDb.query.mockResolvedValueOnce({ rows: [] });
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // memory sync

    const ws1 = await connectWs(roomId);
    const ws2 = await connectWs(roomId2);

    const room1Messages: unknown[] = [];
    const room2Messages: unknown[] = [];

    ws1.socket.on('message', (d) => room1Messages.push(JSON.parse(d.toString())));
    ws2.socket.on('message', (d) => room2Messages.push(JSON.parse(d.toString())));

    // Authenticate both
    ws1.socket.send(JSON.stringify({ type: 'auth', token: token1 }));
    ws2.socket.send(JSON.stringify({ type: 'auth', token: token2 }));

    // Wait for auth + sync
    await new Promise((r) => setTimeout(r, 300));

    const beforeCount1 = room1Messages.length;
    const beforeCount2 = room2Messages.length;

    // Post a connection to room 1 only
    mockDb.query.mockImplementation((q: string) => {
      if (q.includes('FROM rooms')) return Promise.resolve({ rows: [{ id: roomId }] });
      if (q.includes('SELECT chain_id FROM room_node_positions')) return Promise.resolve({ rows: [{ chain_id: 'test-chain-id' }] });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    
    await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token1}` },
      payload: { fromZoneId: VALID_ZONE_A, toZoneId: VALID_ZONE_B, secondsRemaining: 1800, slots: 7 },
    });

    await new Promise((r) => setTimeout(r, 500));

    // Room 1 client should get connection_added
    const newRoom1 = room1Messages.slice(beforeCount1);
    expect(newRoom1.some((m) => (m as { type: string }).type === 'connection_added')).toBe(true);

    // Room 2 client should NOT get it
    const newRoom2 = room2Messages.slice(beforeCount2);
    expect(newRoom2.some((m) => (m as { type: string }).type === 'connection_added')).toBe(false);

    ws1.close();
    ws2.close();
  });

  it('updates rooms.updated_at when updateLastUpdated is true in update_node_positions', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId, home_zone_id: VALID_ZONE_A, created_at: new Date().toISOString(), chain_migrated: true }] }); // room sync
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: 'test-chain-id', source_zone_id: VALID_ZONE_A }] }); // chains
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections sync
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // node positions sync

    const mockClient = {
      query: vi.fn().mockImplementation((q) => {
        if (q.includes('SELECT home_zone_id FROM rooms')) return { rows: [{ home_zone_id: VALID_ZONE_A }] };
        if (q.includes('SELECT x, y FROM room_node_positions')) return { rows: [{ x: 0, y: 0 }] };
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    mockDb.connect.mockResolvedValue(mockClient);

    await app.listen({ port: 0 });
    const { socket } = await connectWs(roomId);
    socket.send(JSON.stringify({ type: 'auth', token }));
    await new Promise((r) => setTimeout(r, 100)); // wait for sync

    socket.send(JSON.stringify({ 
      type: 'update_node_positions', 
      nodePositions: [{ zoneId: VALID_ZONE_A, x: 10, y: 10, features: { reds: 1 } }],
      updateLastUpdated: true 
    }));

    await new Promise((r) => setTimeout(r, 200));

    // Check if rooms table was updated
    const updateCall = mockClient.query.mock.calls.find(call => call[0].includes('UPDATE rooms SET updated_at'));
    expect(updateCall).toBeDefined();

    socket.close();
  });

  it('does NOT update rooms.updated_at when updateLastUpdated is missing in update_node_positions', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId, home_zone_id: VALID_ZONE_A, created_at: new Date().toISOString(), chain_migrated: true }] }); // room sync
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: 'test-chain-id', source_zone_id: VALID_ZONE_A }] }); // chains
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections sync
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // node positions sync

    const mockClient = {
      query: vi.fn().mockImplementation((q) => {
        if (q.includes('SELECT home_zone_id FROM rooms')) return { rows: [{ home_zone_id: VALID_ZONE_A }] };
        if (q.includes('SELECT x, y FROM room_node_positions')) return { rows: [{ x: 0, y: 0 }] };
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    mockDb.connect.mockResolvedValue(mockClient);

    await app.listen({ port: 0 });
    const { socket } = await connectWs(roomId);
    socket.send(JSON.stringify({ type: 'auth', token }));
    await new Promise((r) => setTimeout(r, 100)); // wait for sync

    socket.send(JSON.stringify({ 
      type: 'update_node_positions', 
      nodePositions: [{ zoneId: VALID_ZONE_A, x: 10, y: 10 }]
    }));

    await new Promise((r) => setTimeout(r, 200));

    // Check if rooms table was updated
    const updateCall = mockClient.query.mock.calls.find(call => call[0].includes('UPDATE rooms SET updated_at'));
    expect(updateCall).toBeUndefined();

    socket.close();
  });

  it('does NOT save non-roads zones to memory when updating node positions', async () => {
    const VALID_ROADS_ZONE = 'cases-ugumlos';
    const VALID_NON_ROADS_ZONE = 'adrens-hill';
    
    await app.listen({ port: 0 });

    const { socket } = await connectWs(roomId);

    // Auth mocks
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId, home_zone_id: VALID_ROADS_ZONE, created_at: new Date().toISOString() }] });
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // node positions
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // memory sync

    socket.send(JSON.stringify({ type: 'auth', token }));
    await new Promise((r) => setTimeout(r, 100));

    const nodePositions = [
      {
        zoneId: VALID_NON_ROADS_ZONE,
        x: 100,
        y: 100,
        features: {
          treasuresGreenCount: 3
        }
      }
    ];

    const mockClient = await mockDb.connect();
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockClient.query.mockResolvedValueOnce({ rows: [{ home_zone_id: VALID_ROADS_ZONE }] }); // room lock
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // DELETE room_node_positions
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // INSERT room_node_positions
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // COMMIT

    // Re-read after save
    mockDb.query.mockResolvedValueOnce({ rows: [{ zone_id: VALID_NON_ROADS_ZONE, x: 100, y: 100, features: nodePositions[0].features, custom_handles: null, explored: true, rotation: 0 }] });

    socket.send(JSON.stringify({ type: 'update_node_positions', nodePositions }));
    await new Promise((r) => setTimeout(r, 200));

    // Verify INSERT/UPDATE room_node_memory was NOT called for non-roads zone
    const updateCall = mockDb.query.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && (call[0].includes('UPDATE room_node_memory') || call[0].includes('INSERT INTO room_node_memory'))
    );
    expect(updateCall).toBeUndefined();

    socket.close();
  });

  it('broadcasts room_deleted to all connected clients when the room is deleted via HTTP', async () => {
    const bcrypt = await import('bcrypt');
    const adminHash = await bcrypt.default.hash('admin-secret', 1);

    // Mock: sync (room, connections, node positions)
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId, home_zone_id: VALID_ZONE_A, created_at: new Date().toISOString(), chain_migrated: true }] });
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: 'test-chain-id', source_zone_id: VALID_ZONE_A }] }); // chains
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // node positions

    await app.listen({ port: 0 });

    const { socket } = await connectWs(roomId);
    const messages: unknown[] = [];
    socket.on('message', (d) => messages.push(JSON.parse(d.toString())));

    // Authenticate
    socket.send(JSON.stringify({ type: 'auth', token }));
    await new Promise((r) => setTimeout(r, 200)); // wait for auth_ok + sync

    // Mock for the DELETE /api/rooms/:id endpoint
    mockDb.query.mockResolvedValueOnce({ rows: [{ admin_password_hash: adminHash }] });
    const clientMock = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    mockDb.connect.mockResolvedValueOnce(clientMock);

    // Delete the room as the owner
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { adminPassword: 'admin-secret' },
    });
    expect(deleteRes.statusCode).toBe(204);

    // Wait for the broadcast to reach the connected WS client
    await new Promise((r) => setTimeout(r, 200));

    const roomDeletedMsg = messages.find((m) => (m as { type: string }).type === 'room_deleted');
    expect(roomDeletedMsg).toBeDefined();

    socket.close();
  });

  it('closes with 4401 when auth token roomId does not match the WebSocket room', async () => {
    // Token is a valid JWT but its roomId claim is for a different room
    const wrongRoomToken = app.jwt.sign({ roomId: 'some-other-room' });

    await app.listen({ port: 0 });

    const { socket } = await connectWs(roomId);
    const closeCode = await new Promise<number>((resolve) => {
      socket.on('close', (code) => resolve(code));
      socket.send(JSON.stringify({ type: 'auth', token: wrongRoomToken }));
    });

    expect(closeCode).toBe(4401);
  });

  it('sends session_expired message and closes with 4401 when an action is attempted after the session token has expired', async () => {
    // Authenticate with a token that expires in 1 second
    const shortLivedToken = app.jwt.sign({ roomId }, { expiresIn: 1 });

    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId, home_zone_id: VALID_ZONE_A, created_at: new Date().toISOString(), chain_migrated: true }] });
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: 'test-chain-id', source_zone_id: VALID_ZONE_A }] }); // chains
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // node positions
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // memory

    await app.listen({ port: 0 });

    const { socket } = await connectWs(roomId);
    const messages: unknown[] = [];

    // Authenticate while the token is still valid
    socket.send(JSON.stringify({ type: 'auth', token: shortLivedToken }));
    await new Promise((r) => setTimeout(r, 200)); // wait for auth_ok + sync

    // Wait for the token to expire
    await new Promise((r) => setTimeout(r, 1100));

    // Now attempt an action — the server should detect the expired token
    const closeCode = await new Promise<number>((resolve) => {
      socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
      socket.on('close', (code) => resolve(code));
      socket.send(JSON.stringify({ type: 'update_plot_route', plottedRoute: [VALID_ZONE_A] }));
    });

    expect(closeCode).toBe(4401);
    const expiredMsg = messages.find((m) => (m as { type: string }).type === 'session_expired') as { type: string; reason: string } | undefined;
    expect(expiredMsg).toBeDefined();
    expect(expiredMsg?.reason).toBe('Session expired, please log in again');
  });
});

describe('Regression: chain_id is preserved through update_node_positions', () => {
  it('preserves chain_id when re-inserting an existing node, so POST /connections from that node succeeds', async () => {
    // Repro of the user-reported bug: fresh room with a single non-roads home zone
    // (willowsigh-marsh, chain_migrated=true, chain-1 is the primary chain). After
    // the client drags the home node, ws.ts handles update_node_positions by
    // DELETE-then-INSERTing every row in room_node_positions. The bug was that the
    // INSERT path did not preserve the existing chain_id, so the home node's
    // chain_id became NULL. The user then tried to draw a connection out of the
    // home node and POST /connections returned 400:
    //   "Source zone is not part of any chain in this room".
    //
    // This test asserts both halves:
    //   1) The INSERT carried out by update_node_positions stamps the existing
    //      chain_id (chain-1) onto the re-inserted row.
    //   2) A subsequent POST /connections from willowsigh-marsh → cetitos-aiayrom
    //      finds the chain and responds 201.
    const HOME_ZONE = 'willowsigh-marsh'; // non-roads, royal
    const TARGET_ZONE = 'cetitos-aiayrom';
    const CHAIN_ID = 'chain-1';

    // Auth/sync mocks (room, chains, connections, node positions, memory)
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: roomId, home_zone_id: HOME_ZONE, created_at: new Date().toISOString(), chain_migrated: true }] });
    mockDb.query.mockResolvedValueOnce({ rows: [{ id: CHAIN_ID, source_zone_id: HOME_ZONE }] });
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // connections
    mockDb.query.mockResolvedValueOnce({ rows: [{ zone_id: HOME_ZONE, x: 0, y: 0, features: {}, custom_handles: null, rotation: 0, explored: false }] });
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // memory

    // update_node_positions transactional client. Returns the existing chain_id
    // for the home zone so the preservation logic in ws.ts has something to read.
    const mockClient = {
      query: vi.fn().mockImplementation((q: string) => {
        if (typeof q === 'string') {
          if (q.includes('SELECT home_zone_id FROM rooms')) return Promise.resolve({ rows: [{ home_zone_id: HOME_ZONE }] });
          if (q.includes('SELECT zone_id, chain_id FROM room_node_positions')) {
            return Promise.resolve({ rows: [{ zone_id: HOME_ZONE, chain_id: CHAIN_ID }] });
          }
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
      release: vi.fn(),
    };
    mockDb.connect.mockResolvedValue(mockClient);

    await app.listen({ port: 0 });
    const { socket } = await connectWs(roomId);
    socket.send(JSON.stringify({ type: 'auth', token }));
    await new Promise((r) => setTimeout(r, 150));

    // Client drags the home node — same shape the real client sends.
    socket.send(JSON.stringify({
      type: 'update_node_positions',
      nodePositions: [{ zoneId: HOME_ZONE, x: -13.3, y: -6.9, features: {}, customHandles: null, rotation: 0, explored: false }],
      updateLastUpdated: false,
    }));
    await new Promise((r) => setTimeout(r, 200));

    // Assert 1: the INSERT INTO room_node_positions call carried chain_id = CHAIN_ID.
    const insertCall = mockClient.query.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO room_node_positions')
    );
    expect(insertCall).toBeDefined();
    const insertParams = insertCall![1] as any[];
    // Params shape: [roomId, zoneId, x, y, features, customHandles, rotation, explored, chain_id]
    expect(insertParams[1]).toBe(HOME_ZONE);
    expect(insertParams[insertParams.length - 1]).toBe(CHAIN_ID);

    // Assert 2: subsequent POST /connections from the home zone to a brand-new
    // target zone must succeed (no "Source zone is not part of any chain" error).
    // Reset the top-level db mock to respond to the connection-route queries.
    mockDb.query.mockImplementation((q: string) => {
      if (typeof q !== 'string') return Promise.resolve({ rows: [], rowCount: 0 });
      if (q.includes('FROM rooms')) return Promise.resolve({ rows: [{ id: roomId }] });
      if (q.includes('SELECT chain_id FROM room_node_positions')) {
        return Promise.resolve({ rows: [{ chain_id: CHAIN_ID }] });
      }
      if (q.includes('FROM connections')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/connections`,
      headers: { authorization: `Bearer ${token}` },
      payload: { fromZoneId: HOME_ZONE, toZoneId: TARGET_ZONE, secondsRemaining: 1800, slots: 7 },
    });
    expect(res.statusCode).toBe(201);

    socket.close();
  });
});

describe('WebSocket lazy chain migration', () => {
  it('runs the migration on a legacy room, backfills chain_id, flips the flag, and broadcasts force_reload (no sync)', async () => {
    // Provide a migration-transaction client whose query calls we can inspect.
    const migrationClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    mockDb.connect.mockResolvedValue(migrationClient);

    // Room row WITHOUT chain_migrated → falsy → triggers migration
    mockDb.query.mockResolvedValueOnce({
      rows: [{ id: roomId, home_zone_id: VALID_ZONE_A, created_at: new Date().toISOString(), chain_migrated: false }],
    });

    const { broadcast } = await import('../src/broadcast.js');
    const broadcastSpy = vi.spyOn(await import('../src/broadcast.js'), 'broadcast');
    broadcastSpy.mockClear();

    await app.listen({ port: 0 });
    const { socket } = await connectWs(roomId);
    const messages: unknown[] = [];
    socket.on('message', (d) => messages.push(JSON.parse(d.toString())));

    socket.send(JSON.stringify({ type: 'auth', token }));

    // Give the server time to run the migration transaction
    await new Promise((r) => setTimeout(r, 300));

    // The migration must have:
    //   BEGIN, INSERT room_chains, UPDATE connections, UPDATE room_node_positions, UPDATE rooms, COMMIT
    const sqlCalls: string[] = migrationClient.query.mock.calls.map((c: any[]) => String(c[0]));
    expect(sqlCalls.some(s => s.startsWith('BEGIN'))).toBe(true);
    expect(sqlCalls.some(s => s.includes('INSERT INTO room_chains'))).toBe(true);
    expect(sqlCalls.some(s => s.includes('UPDATE connections SET chain_id'))).toBe(true);
    expect(sqlCalls.some(s => s.includes('UPDATE room_node_positions SET chain_id'))).toBe(true);
    expect(sqlCalls.some(s => s.includes('UPDATE rooms SET chain_migrated'))).toBe(true);
    expect(sqlCalls.some(s => s.startsWith('COMMIT'))).toBe(true);

    // It must have broadcast a force_reload for this room and NOT sent a sync to this socket.
    const forceReloadCall = broadcastSpy.mock.calls.find(
      (call: any[]) => call[0] === roomId && (call[1] as any)?.type === 'force_reload'
    );
    expect(forceReloadCall).toBeDefined();

    const syncMsg = messages.find((m) => (m as any).type === 'sync');
    expect(syncMsg).toBeUndefined();

    socket.close();
    broadcastSpy.mockRestore();
    void broadcast; // keep import side-effect referenced
  });
});
