import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

// A known valid zone ID from the shared catalogue
const VALID_ZONE_ID = 'qiient-al-nusom'; 

describe('PUT /api/rooms/:id/import', () => {
  let app: FastifyInstance;
  let mockDb: any;
  let clientMock: any;

  beforeEach(async () => {
    clientMock = {
      query: vi.fn().mockResolvedValue({ rowCount: 1 }),
      release: vi.fn(),
    };
    mockDb = {
      query: vi.fn().mockImplementation((query: string) => {
        if (query.includes('SELECT')) {
           return Promise.resolve({ rows: [{ id: 'test-room', admin_password_hash: 'hash', home_zone_id: VALID_ZONE_ID }], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      connect: vi.fn().mockResolvedValue(clientMock),
    };
    app = await buildApp({ db: mockDb, disableRateLimit: true, jwtSecret: 'test-secret' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('persists explored status when importing node positions', async () => {
    const roomId = 'test-room';
    const token = app.jwt.sign({ roomId });

    const importPayload = {
      homeZoneId: VALID_ZONE_ID,
      connections: [],
      nodePositions: [
        {
          zoneId: 'zone1',
          x: 10,
          y: 20,
          explored: true,
          features: {},
          customHandles: []
        }
      ]
    };

    const res = await app.inject({
      method: 'PUT',
      url: `/api/rooms/${roomId}/import`,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      payload: importPayload,
    });

    expect(res.statusCode).toBe(204);

    // Find the insert query call for room_node_positions
    const insertCall = clientMock.query.mock.calls.find((call: any) => 
        typeof call[0] === 'string' && call[0].includes('INSERT INTO room_node_positions')
    );
    
    expect(insertCall).toBeDefined();
    // The arguments are [query, [id, zoneId, x, y, features, customHandles, explored]]
    const args = insertCall[1];
    expect(args[6]).toBe(true); // Index 6 is explored
  });

  it('round-trips multi-chain exports: inserts every chain and assigns each node/connection to its chain via BFS', async () => {
    // Regression for the "Export fix" — pre-fix, the import path silently
    // collapsed everything into a fresh primary chain, losing secondary chains.
    // Now an export that includes `chains` must produce one room_chains row per
    // chain and stamp each node/connection with the chain reachable from its
    // sourceZoneId.
    const roomId = 'test-room';
    const token = app.jwt.sign({ roomId });

    // VALID_ZONE_ID is the primary home; pick another catalogue zone as the
    // secondary chain source and put it on its own disconnected component.
    const SECONDARY_SOURCE = 'willowsigh-marsh';
    const PRIMARY_NEIGHBOUR = 'aspenwood';
    const SECONDARY_NEIGHBOUR = 'cetitos-aiayrom';

    const importPayload = {
      homeZoneId: VALID_ZONE_ID,
      connections: [
        // Primary-chain edge
        { fromZoneId: VALID_ZONE_ID, toZoneId: PRIMARY_NEIGHBOUR, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
        // Secondary-chain edge
        { fromZoneId: SECONDARY_SOURCE, toZoneId: SECONDARY_NEIGHBOUR, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
      ],
      nodePositions: [
        { zoneId: VALID_ZONE_ID, x: 0, y: 0, features: {}, customHandles: [] },
        { zoneId: PRIMARY_NEIGHBOUR, x: 10, y: 0, features: {}, customHandles: [] },
        { zoneId: SECONDARY_SOURCE, x: 100, y: 0, features: {}, customHandles: [] },
        { zoneId: SECONDARY_NEIGHBOUR, x: 110, y: 0, features: {}, customHandles: [] },
      ],
      chains: [
        { sourceZoneId: VALID_ZONE_ID },
        { sourceZoneId: SECONDARY_SOURCE },
      ],
    };

    const res = await app.inject({
      method: 'PUT',
      url: `/api/rooms/${roomId}/import`,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      payload: importPayload,
    });
    expect(res.statusCode).toBe(204);

    // Both chains were inserted.
    const chainInserts = clientMock.query.mock.calls.filter(
      (call: any) => typeof call[0] === 'string' && call[0].includes('INSERT INTO room_chains')
    );
    expect(chainInserts).toHaveLength(2);
    const chainIdBySource = new Map<string, string>(
      chainInserts.map((call: any) => [call[1][2], call[1][0]])
    );
    const primaryId = chainIdBySource.get(VALID_ZONE_ID)!;
    const secondaryId = chainIdBySource.get(SECONDARY_SOURCE)!;
    expect(primaryId).toBeDefined();
    expect(secondaryId).toBeDefined();
    expect(primaryId).not.toBe(secondaryId);

    // Each node is stamped with the chain reachable from its zone.
    const nodeInserts = clientMock.query.mock.calls.filter(
      (call: any) => typeof call[0] === 'string' && call[0].includes('INSERT INTO room_node_positions')
    );
    const chainIdByZone = new Map<string, string>(
      nodeInserts.map((call: any) => [call[1][1], call[1][8]])
    );
    expect(chainIdByZone.get(VALID_ZONE_ID)).toBe(primaryId);
    expect(chainIdByZone.get(PRIMARY_NEIGHBOUR)).toBe(primaryId);
    expect(chainIdByZone.get(SECONDARY_SOURCE)).toBe(secondaryId);
    expect(chainIdByZone.get(SECONDARY_NEIGHBOUR)).toBe(secondaryId);

    // Each connection's chain_id matches its from-zone's chain.
    const connInserts = clientMock.query.mock.calls.filter(
      (call: any) => typeof call[0] === 'string' && call[0].includes('INSERT INTO connections')
    );
    const connByFrom = new Map<string, string>(
      connInserts.map((call: any) => [call[1][2], call[1][9]])
    );
    expect(connByFrom.get(VALID_ZONE_ID)).toBe(primaryId);
    expect(connByFrom.get(SECONDARY_SOURCE)).toBe(secondaryId);
  });
});
