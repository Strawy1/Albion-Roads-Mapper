import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestApp } from './testApp.js';
import type { FastifyInstance } from 'fastify';

const CHAIN_A = 'chain-a-id';
const CHAIN_B = 'chain-b-id';

// Two valid zone IDs from the shared zone catalogue
const ZONE_A = 'adrens-hill';
const ZONE_B = 'anklesnag-mire';

const testApp = setupTestApp();
const { roomId } = testApp;
let app: FastifyInstance;
let mockDb: any;
let token: string;

beforeEach(() => {
  ({ app, mockDb, token } = testApp);
});

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


async function authenticateSocket(socket: import('ws').WebSocket): Promise<void> {
  // Set up DB mocks for auth/sync
  mockDb.query
    .mockResolvedValueOnce({ rows: [{ id: roomId, home_zone_id: ZONE_A, created_at: new Date().toISOString(), chain_migrated: true }] }) // room
    .mockResolvedValueOnce({ rows: [{ id: CHAIN_A, source_zone_id: ZONE_A }] }) // chains
    .mockResolvedValueOnce({ rows: [] }) // connections
    .mockResolvedValueOnce({ rows: [] }); // node positions

  const authOk = new Promise<void>((resolve) => {
    socket.on('message', function handler(data) {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'auth_ok' || msg.type === 'sync') {
        socket.off('message', handler);
        resolve();
      }
    });
  });

  socket.send(JSON.stringify({ type: 'auth', token }));
  await authOk;
  // Wait a tick for sync to complete
  await new Promise((r) => setTimeout(r, 50));
}

describe('WebSocket create_connection', () => {
  it('sends error when source and destination are in different chains', async () => {
    await app.listen({ port: 0 });
    const { socket } = await connectWs(roomId);
    await authenticateSocket(socket);

    // Mock DB: fromZone is in CHAIN_A, toZone is in CHAIN_B
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ chain_id: CHAIN_A }] }) // fromZone chain lookup
      .mockResolvedValueOnce({ rows: [{ chain_id: CHAIN_B }] }); // toZone chain lookup

    const errorMsg = await new Promise<any>((resolve) => {
      socket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'error') resolve(msg);
      });
      socket.send(JSON.stringify({
        type: 'create_connection',
        fromZoneId: ZONE_A,
        toZoneId: ZONE_B,
        secondsRemaining: 1800,
        slots: 7,
      }));
    });

    expect(errorMsg.type).toBe('error');
    expect(errorMsg.message).toBe('Connections may not bridge two different chains');

    socket.close();
  });

  it('broadcasts connection_added when both zones are in the same chain', async () => {
    await app.listen({ port: 0 });
    const { socket } = await connectWs(roomId);
    await authenticateSocket(socket);

    const connId = '550e8400-e29b-41d4-a716-446655440000';

    // Mock DB sequence for a successful same-chain connection (no targetPosition)
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ chain_id: CHAIN_A }] })  // fromZone chain lookup
      .mockResolvedValueOnce({ rows: [{ chain_id: CHAIN_A }] })  // toZone chain lookup
      .mockResolvedValueOnce({ rows: [] })                        // existing connections (no cycle)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })           // UPDATE slots on toZone
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })           // UPDATE lastUpdatedAt on fromZone
      .mockResolvedValueOnce({ rows: [                            // SELECT node positions
        { zone_id: ZONE_A, x: 0, y: 0, features: {}, custom_handles: null, rotation: 0, chain_id: CHAIN_A },
        { zone_id: ZONE_B, x: 1, y: 1, features: {}, custom_handles: null, rotation: 0, chain_id: CHAIN_A },
      ] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })           // INSERT connection
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });          // trackRoomModified

    const connectionAddedMsg = await new Promise<any>((resolve) => {
      socket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'connection_added') resolve(msg);
      });
      socket.send(JSON.stringify({
        type: 'create_connection',
        fromZoneId: ZONE_A,
        toZoneId: ZONE_B,
        secondsRemaining: 1800,
        slots: 7,
      }));
    });

    expect(connectionAddedMsg.type).toBe('connection_added');
    expect(connectionAddedMsg.connection.fromZoneId).toBe(ZONE_A);
    expect(connectionAddedMsg.connection.toZoneId).toBe(ZONE_B);
    expect(connectionAddedMsg.connection.chainId).toBe(CHAIN_A);

    socket.close();
  });

  it('sends error when source zone has no chain', async () => {
    await app.listen({ port: 0 });
    const { socket } = await connectWs(roomId);
    await authenticateSocket(socket);

    // fromZone has no chain_id
    mockDb.query.mockResolvedValueOnce({ rows: [{ chain_id: null }] });

    const errorMsg = await new Promise<any>((resolve) => {
      socket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'error') resolve(msg);
      });
      socket.send(JSON.stringify({
        type: 'create_connection',
        fromZoneId: ZONE_A,
        toZoneId: ZONE_B,
        secondsRemaining: 1800,
        slots: 7,
      }));
    });

    expect(errorMsg.type).toBe('error');
    expect(errorMsg.message).toBe('Source zone is not part of any chain in this room');

    socket.close();
  });
});
