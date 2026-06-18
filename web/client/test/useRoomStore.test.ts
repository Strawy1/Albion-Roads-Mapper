import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach } from 'vitest';
import { useRoomStore } from '@/stores/useRoomStore';

// Mock WebSocket
if (typeof global.WebSocket === 'undefined') {
  (global as any).WebSocket = class {
    static OPEN = 1;
    readyState = 1;
    send() {}
    close() {}
    addEventListener() {}
    removeEventListener() {}
  };
}

describe('useRoomStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('should clear all state when disconnect is called', () => {
    const store = useRoomStore();
    
    // Set some state
    store.connections = [{ 
      id: '1', 
      roomId: 'room1', 
      fromZoneId: 'z1', 
      toZoneId: 'z2', 
      expiresAt: '2026-04-26T18:00:00Z', 
      reportedAt: '2026-04-26T18:00:00Z' 
    }];
    store.homeZoneId = 'zone1';
    store.nodePositions = [{ zoneId: 'zone1', x: 10, y: 10 }];
    // Call disconnect
    store.disconnect();
    
    // Verify state
    expect(store.connections).toEqual([]);
    expect(store.homeZoneId).toBe('');
    expect(store.nodePositions).toEqual([]);
  });

  it('updateNodeCustomHandles should set lastUpdatedAt on node features', () => {
    const store = useRoomStore();
    store.setCredentials('room1', 'token1');
    store.nodePositions = [{ zoneId: 'z1', x: 0, y: 0 }];

    const before = Date.now();
    store.updateNodeCustomHandles('z1', [{ id: 'h1', left: '50%', top: '0%' }]);
    const after = Date.now();

    const features = store.nodePositions[0].features;
    expect(features).toBeDefined();
    expect(features!.lastUpdatedAt).toBeGreaterThanOrEqual(before);
    expect(features!.lastUpdatedAt).toBeLessThanOrEqual(after);
  });

  it('should update node features and update local state', () => {
    const store = useRoomStore();
    
    // Setup initial state
    store.setCredentials('room1', 'token1');
    store.nodePositions = [
      { zoneId: 'z1', x: 0, y: 0 },
      { zoneId: 'z2', x: 10, y: 10 }
    ];

    const features = { reds: 5, powercoreGreen: true };
    store.updateNodeFeatures('z1', features);

    // Verify local state update (optimistic) — store also injects lastUpdatedAt
    expect(store.nodePositions[0].features).toEqual(expect.objectContaining(features));
  });

  it('should NOT update lastUpdate when node positions are updated (default reason)', () => {
    const store = useRoomStore();
    const initialDate = new Date('2026-04-28T10:00:00Z');
    store.lastUpdate = initialDate;
    
    store.updateNodePositionsInStore([{ zoneId: 'z1', x: 100, y: 100 }]);
    
    expect(store.lastUpdate).toBe(initialDate);
  });

  it('should NOT update lastUpdate when node_positions_updated message is received without flag', () => {
    const store = useRoomStore();
    const initialDate = new Date('2026-04-28T10:00:00Z');
    store.lastUpdate = initialDate;
    
    store.applyMessage({
      type: 'node_positions_updated',
      nodePositions: [{ zoneId: 'z1', x: 100, y: 100 }]
    });
    
    expect(store.lastUpdate).toBe(initialDate);
  });

  it('should update lastUpdate when updateNodeFeatures is called', () => {
    const store = useRoomStore();
    const initialDate = new Date('2026-04-28T10:00:00Z');
    store.lastUpdate = initialDate;
    store.nodePositions = [{ zoneId: 'z1', x: 0, y: 0 }];
    
    store.updateNodeFeatures('z1', { reds: 5 });
    
    expect(store.lastUpdate).not.toBe(initialDate);
  });

  it('should update lastUpdate when node_positions_updated message is received with updateLastUpdated flag', () => {
    const store = useRoomStore();
    const initialDate = new Date('2026-04-28T10:00:00Z');
    store.lastUpdate = initialDate;
    
    store.applyMessage({
      type: 'node_positions_updated',
      nodePositions: [{ zoneId: 'z1', x: 100, y: 100 }],
      updateLastUpdated: true
    });
    
    expect(store.lastUpdate).not.toBe(initialDate);
  });

  it('should set wsStatus to auth_failed when close code is 4401', () => {
    const store = useRoomStore();
    
    // Mock WebSocket with addEventListener support
    let closeHandler: any;
    (global as any).WebSocket = class {
      static OPEN = 1;
      readyState = 1;
      send() {}
      close() {}
      addEventListener(type: string, handler: any) {
        if (type === 'close') closeHandler = handler;
      }
      removeEventListener() {}
    };

    store.setCredentials('room1', 'token1');
    store.connect();
    
    closeHandler({ code: 4401 });
    
    expect(store.wsStatus).toBe('auth_failed');
  });

  it('should never restrict home zone', () => {
    const store = useRoomStore();
    store.homeZoneId = 'home-zone';
    
    // Add an expired connection
    const now = Date.now();
    store.connections = [{
      id: 'conn1',
      roomId: 'room1',
      fromZoneId: 'home-zone',
      toZoneId: 'other-zone',
      expiresAt: new Date(now - 1000).toISOString(),
      reportedAt: new Date().toISOString(),
      isExpired: true
    }];
    
    // Verify home zone is not restricted
    expect(store.isNodeRestricted('home-zone', Date.now())).toBe(false);
  });

  it('existing explored node remains explored after another node is added via node_positions_updated', async () => {
    const store = useRoomStore();

    // Start with two nodes; z1 is explored (e.g. has a non-center handle connection)
    store.nodePositions = [
      { zoneId: 'z1', x: 0, y: 0, explored: true },
      { zoneId: 'z2', x: 10, y: 10, explored: false },
    ];

    // Simulate another client adding a new node (z3) — the broadcast contains ALL positions
    // including the new one, but z1's explored flag must be preserved
    store.applyMessage({
      type: 'node_positions_updated',
      nodePositions: [
        { zoneId: 'z1', x: 0, y: 0, explored: false }, // server sends false, but local is true
        { zoneId: 'z2', x: 10, y: 10, explored: false },
        { zoneId: 'z3', x: 20, y: 20, explored: false }, // newly added node
      ],
    });

    // Wait a tick for any async logic
    await new Promise(resolve => setTimeout(resolve, 10));

    const z1 = store.nodePositions.find(n => n.zoneId === 'z1');
    expect(z1).toBeDefined();
    expect(z1!.explored).toBe(true); // must remain explored
    expect(store.nodePositions).toHaveLength(3); // all three nodes present
  });

  it('updateNodePositionsInStore sends a FULL snapshot even when called with a partial list (regression: adding a new chain must not wipe other chains\' nodes)', () => {
    const store = useRoomStore();

    // Capture every message the store sends over the WS.
    const sent: any[] = [];
    (global as any).WebSocket = class {
      static OPEN = 1;
      readyState = 1;
      onopen: any;
      send(payload: string) { sent.push(JSON.parse(payload)); }
      close() {}
      addEventListener(type: string, handler: any) {
        if (type === 'open') setTimeout(() => handler(), 0);
        if (type === 'message') {/* noop */}
      }
      removeEventListener() {}
    };

    store.setCredentials('room1', 'token1');
    store.connect();

    // Seed three preexisting nodes belonging to two different chains.
    store.nodePositions = [
      { zoneId: 'home', x: 0, y: 0, explored: true, chainId: 'chain-1' },
      { zoneId: 'c1-child', x: 50, y: 50, explored: true, chainId: 'chain-1' },
      { zoneId: 'c2-source', x: 200, y: 0, explored: false, chainId: 'chain-2' },
    ];

    // Simulate addChain's placement step: update ONLY the new chain's source
    // zone position. The payload sent over the WS must still contain ALL
    // preexisting nodes — otherwise the server (which does DELETE + reinsert)
    // would wipe them.
    store.updateNodePositionsInStore([
      { zoneId: 'c2-source', x: 175, y: 100 } as any,
    ]);

    const updateMsg = sent.find(m => m.type === 'update_node_positions');
    expect(updateMsg).toBeDefined();
    const zoneIds = updateMsg.nodePositions.map((p: any) => p.zoneId).sort();
    expect(zoneIds).toEqual(['c1-child', 'c2-source', 'home']);

    // Preexisting nodes retain their coords (server would otherwise overwrite).
    const home = updateMsg.nodePositions.find((p: any) => p.zoneId === 'home');
    expect(home.x).toBe(0);
    expect(home.y).toBe(0);
    const child = updateMsg.nodePositions.find((p: any) => p.zoneId === 'c1-child');
    expect(child.x).toBe(50);
    expect(child.y).toBe(50);
    // Updated node reflects the new coords.
    const updated = updateMsg.nodePositions.find((p: any) => p.zoneId === 'c2-source');
    expect(updated.x).toBe(175);
    expect(updated.y).toBe(100);
    // chainId membership is preserved through the overlay.
    expect(updated.chainId).toBe('chain-2');
  });

  it('applyMessage(chain_added) + single-row node_positions_updated does NOT mutate preexisting coords (regression: adding a chain must not move other zones)', () => {
    const store = useRoomStore();
    store.setCredentials('room1', 'token1');

    // Seed two preexisting chains' nodes at non-zero coords.
    store.homeZoneId = 'home';
    store.chains = [
      { id: 'chain-1', sourceZoneId: 'home', chainNumber: 1, chainColor: '#10b981', createdAt: new Date().toISOString() } as any,
    ];
    store.nodePositions = [
      { zoneId: 'home',     x: 10,  y: 20,  explored: true,  chainId: 'chain-1' },
      { zoneId: 'c1-child', x: 50,  y: 60,  explored: true,  chainId: 'chain-1' },
    ];

    // Simulate the server flow: chain_added arrives first, then a SINGLE-ROW
    // node_positions_updated containing only the new chain's source zone.
    store.applyMessage({
      type: 'chain_added',
      chain: { id: 'chain-2', sourceZoneId: 'c2-source', chainNumber: 2, chainColor: '#3b82f6' } as any,
    } as any);
    store.applyMessage({
      type: 'node_positions_updated',
      nodePositions: [
        { zoneId: 'c2-source', x: 0, y: 0, explored: false, chainId: 'chain-2' },
      ],
    } as any);

    // Preexisting nodes MUST retain their exact coords and chain membership.
    const home = store.nodePositions.find(p => p.zoneId === 'home');
    expect(home).toBeDefined();
    expect(home!.x).toBe(10);
    expect(home!.y).toBe(20);
    expect(home!.chainId).toBe('chain-1');
    const child = store.nodePositions.find(p => p.zoneId === 'c1-child');
    expect(child).toBeDefined();
    expect(child!.x).toBe(50);
    expect(child!.y).toBe(60);
    expect(child!.chainId).toBe('chain-1');
    // New chain source zone is appended with the broadcast's coords.
    const newNode = store.nodePositions.find(p => p.zoneId === 'c2-source');
    expect(newNode).toBeDefined();
    expect(newNode!.x).toBe(0);
    expect(newNode!.y).toBe(0);
    expect(newNode!.chainId).toBe('chain-2');
  });

  it('sets wsStatus to auth_failed and disconnectReason to room_deleted on room_deleted message', () => {
    const store = useRoomStore();
    store.roomId = 'room-to-delete';
    localStorage.setItem('token:room-to-delete', 'some-token');

    store.applyMessage({ type: 'room_deleted' });

    expect(store.wsStatus).toBe('auth_failed');
    expect(store.disconnectReason).toBe('room_deleted');
    expect(localStorage.getItem('token:room-to-delete')).toBeNull();
  });

  it('sets wsStatus to auth_failed and disconnectReason to room_not_found on error message with Room not found', () => {
    const store = useRoomStore();
    store.roomId = 'ghost-room';
    localStorage.setItem('token:ghost-room', 'old-token');

    store.applyMessage({ type: 'error', message: 'Room not found' });

    expect(store.wsStatus).toBe('auth_failed');
    expect(store.disconnectReason).toBe('room_not_found');
    expect(localStorage.getItem('token:ghost-room')).toBeNull();
  });

  it('does NOT change wsStatus on error message with an unrelated message', () => {
    const store = useRoomStore();
    store.roomId = 'room1';
    store.wsStatus = 'connected';

    store.applyMessage({ type: 'error', message: 'Something else went wrong' });

    expect(store.wsStatus).toBe('connected');
    expect(store.disconnectReason).toBeNull();
  });

  it('updateNodeFeatures: does NOT mark unexplored zone as explored when markExplored is false', () => {
    const store = useRoomStore();
    store.nodePositions = [{ zoneId: 'zone-a', x: 0, y: 0, explored: false }];

    store.updateNodeFeatures('zone-a', { slots: 20 }, false);

    expect(store.nodePositions[0].explored).toBe(false);
  });

  it('updateNodeFeatures: DOES mark unexplored zone as explored when markExplored is true (default)', () => {
    const store = useRoomStore();
    store.nodePositions = [{ zoneId: 'zone-a', x: 0, y: 0, explored: false }];

    store.updateNodeFeatures('zone-a', { reds: 3 });

    expect(store.nodePositions[0].explored).toBe(true);
  });

  it('connection_updated: does NOT mark unexplored destination as explored when only time is changed', () => {
    const store = useRoomStore();

    // Set up a connection that already has a non-center handle (e.g. was created with a portal handle)
    const now = Date.now();
    const conn = {
      id: 'conn1',
      roomId: 'room1',
      fromZoneId: 'zone-a',
      toZoneId: 'zone-b',
      fromHandleId: 'n',
      toHandleId: 's',
      expiresAt: new Date(now + 100000).toISOString(),
      reportedAt: new Date(now).toISOString(),
    };

    // zone-b is currently unexplored
    store.connections = [conn];
    store.nodePositions = [
      { zoneId: 'zone-a', x: 0, y: 0, explored: true },
      { zoneId: 'zone-b', x: 10, y: 10, explored: false },
    ];

    // Receive a connection_updated message where only the time changed (handles unchanged)
    store.applyMessage({
      type: 'connection_updated',
      connection: {
        ...conn,
        expiresAt: new Date(now + 200000).toISOString(), // only time changed
      },
    } as any);

    // zone-b must remain unexplored because no handle change occurred
    const zoneB = store.nodePositions.find(n => n.zoneId === 'zone-b');
    expect(zoneB!.explored).toBe(false);
  });

  it('connection_updated: does NOT mark unexplored destination as explored when only portal size is changed', () => {
    const store = useRoomStore();

    const now = Date.now();
    const conn = {
      id: 'conn1',
      roomId: 'room1',
      fromZoneId: 'zone-a',
      toZoneId: 'zone-b',
      fromHandleId: 'n',
      toHandleId: 's',
      slots: 7,
      expiresAt: new Date(now + 100000).toISOString(),
      reportedAt: new Date(now).toISOString(),
    };

    store.connections = [conn];
    store.nodePositions = [
      { zoneId: 'zone-a', x: 0, y: 0, explored: true },
      { zoneId: 'zone-b', x: 10, y: 10, explored: false },
    ];

    // Receive a connection_updated message where only slots changed (handles unchanged)
    store.applyMessage({
      type: 'connection_updated',
      connection: {
        ...conn,
        slots: 20, // only portal size changed
      },
    } as any);

    const zoneB = store.nodePositions.find(n => n.zoneId === 'zone-b');
    expect(zoneB!.explored).toBe(false);
  });

  it('connection_updated: DOES mark unexplored destination as explored when toHandleId changes to non-center', () => {
    const store = useRoomStore();

    const now = Date.now();
    const conn = {
      id: 'conn1',
      roomId: 'room1',
      fromZoneId: 'zone-a',
      toZoneId: 'zone-b',
      fromHandleId: null,
      toHandleId: null, // was center
      expiresAt: new Date(now + 100000).toISOString(),
      reportedAt: new Date(now).toISOString(),
    };

    store.connections = [conn];
    store.nodePositions = [
      { zoneId: 'zone-a', x: 0, y: 0, explored: false },
      { zoneId: 'zone-b', x: 10, y: 10, explored: false },
    ];

    // Handle changed from center to a non-center handle
    store.applyMessage({
      type: 'connection_updated',
      connection: {
        ...conn,
        toHandleId: 's', // handle changed to non-center
      },
    } as any);

    // zone-b should now be marked as explored because the handle changed
    const zoneB = store.nodePositions.find(n => n.zoneId === 'zone-b');
    expect(zoneB!.explored).toBe(true);
  });

  it('should not expire parent node if child connection is expired but path to hideout still exists', () => {
    const store = useRoomStore();
    const homeZoneId = 'qiient-in-odetum';
    store.homeZoneId = homeZoneId;
    
    const fetosZoneId = 'fetos-aiaylos';
    const oorosZoneId = 'ooros-ataltum';
    
    const now = Date.now();
    
    // Connection: Home -> Fetos (valid)
    const conn1 = {
      id: 'conn1',
      roomId: 'room1',
      fromZoneId: homeZoneId,
      toZoneId: fetosZoneId,
      expiresAt: new Date(now + 100000).toISOString(),
      reportedAt: new Date().toISOString(),
      isExpired: false
    };
    
    // Connection: Fetos -> Ooros (expired)
    const conn2 = {
      id: 'conn2',
      roomId: 'room1',
      fromZoneId: fetosZoneId,
      toZoneId: oorosZoneId,
      expiresAt: new Date(now - 1000).toISOString(),
      reportedAt: new Date().toISOString(),
      isExpired: true
    };
    
    store.connections = [conn1, conn2];
    
    // Verify fetos is NOT expired
    expect(store.isNodeExpired(fetosZoneId, now)).toBe(false);
  });
});
