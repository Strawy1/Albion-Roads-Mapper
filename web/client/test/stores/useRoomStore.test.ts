import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import { useRoomStore } from '../../src/stores/useRoomStore';

// Shape 't' default handles (unrotated) — matches tasitos-obayam and turitos-uoemtum
const T_SHAPE_DEFAULT = [
  { id: 't-p1', left: '73.20%', top: '23.20%' },
  { id: 't-p2', left: '88.20%', top: '61.80%' },
  { id: 't-p3', left: '77.00%', top: '73.00%' },
  { id: 't-p4', left: '23.80%', top: '73.80%' },
  { id: 't-p5', left: '10.20%', top: '39.80%' },
  { id: 't-p6', left: '38.40%', top: '11.60%' },
];

// Shape 't' handles rotated 180° (step 2) — each coordinate = 100 - original
const T_SHAPE_ROT2 = [
  { id: 't-p1', left: '26.80%', top: '76.80%' },
  { id: 't-p2', left: '11.80%', top: '38.20%' },
  { id: 't-p3', left: '23.00%', top: '27.00%' },
  { id: 't-p4', left: '76.20%', top: '26.20%' },
  { id: 't-p5', left: '89.80%', top: '60.20%' },
  { id: 't-p6', left: '61.60%', top: '88.40%' },
];

describe('useRoomStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('has updateNodePositions method', () => {
    const store = useRoomStore();
    expect(typeof store.updateNodePositionsInStore).toBe('function');
  });

  it('applies room_reset — clears connections and keeps only home node position', () => {
    const store = useRoomStore();
    store.applyMessage({
      type: 'sync',
      connections: [{ id: 'c1', roomId: 'r1', fromZoneId: 'a', toZoneId: 'b', expiresAt: new Date().toISOString(), reportedAt: new Date().toISOString() }],
      homeZoneId: 'home',
      nodePositions: [{ zoneId: 'home', x: 0, y: 0 }, { zoneId: 'b', x: 10, y: 10 }],
      lastUpdatedAt: new Date().toISOString(),
      watching: 0, totalConnected: 0
    });

    store.applyMessage({ type: 'room_reset' });

    expect(store.connections).toHaveLength(0);
    expect(store.nodePositions).toHaveLength(1);
    expect(store.nodePositions[0].zoneId).toBe('home');
  });

  it('marks a node as restricted when connection expires', () => {
    const store = useRoomStore();
    const now = Date.now();
    const expiresAt = new Date(now + 2000).toISOString();
    
    store.applyMessage({
      type: 'sync',
      connections: [{ id: 'c1', roomId: 'r1', fromZoneId: 'home', toZoneId: 'a', expiresAt, reportedAt: new Date().toISOString() }],
      homeZoneId: 'home',
      nodePositions: [{ zoneId: 'home', x: 0, y: 0 }, { zoneId: 'a', x: 10, y: 10 }],
      lastUpdatedAt: new Date().toISOString(),
      watching: 0, totalConnected: 0
    });

    // Check at 1s (before expiry)
    expect(store.isNodeRestricted('a', now + 1000)).toBe(false);

    // Check at 3s (after expiry)
    expect(store.isNodeRestricted('a', now + 3000)).toBe(true);
  });

  it('sets lastPing when a ping message is received', async () => {
    const store = useRoomStore();
    expect(store.lastPing).toBeNull();

    store.applyMessage({ type: 'ping', zoneName: 'Dusklight Fen', nodeId: 'dusklight-fen' });
    await nextTick();

    expect(store.lastPing).toEqual({ zoneName: 'Dusklight Fen', nodeId: 'dusklight-fen' });
  });

  it('sets lastPing with only zoneName when nodeId is omitted', async () => {
    const store = useRoomStore();

    store.applyMessage({ type: 'ping', zoneName: 'Dusklight Fen' });
    await nextTick();

    expect(store.lastPing).toEqual({ zoneName: 'Dusklight Fen', nodeId: undefined });
  });

  describe('rotation error detection', () => {
    // tasitos-obayam has mapShape 't' — a real zone we can use for rotation tests
    const ZONE_ID = 'tasitos-obayam';

    function syncWithHandles(store: ReturnType<typeof useRoomStore>, handles: typeof T_SHAPE_DEFAULT, rotation: number) {
      store.applyMessage({
        type: 'sync',
        connections: [],
        homeZoneId: 'home',
        nodePositions: [
          { zoneId: 'home', x: 0, y: 0 },
          { zoneId: ZONE_ID, x: 10, y: 10, customHandles: handles, rotation },
        ],
        lastUpdatedAt: new Date().toISOString(),
        watching: 0, totalConnected: 0,
      });
    }

    it('detects no rotation error when handles match stored rotation=0', () => {
      const store = useRoomStore();
      syncWithHandles(store, T_SHAPE_DEFAULT, 0);
      expect(store.rotationErrors).not.toContain(ZONE_ID);
    });

    it('detects no rotation error when handles match stored rotation=2', () => {
      const store = useRoomStore();
      syncWithHandles(store, T_SHAPE_ROT2, 2);
      expect(store.rotationErrors).not.toContain(ZONE_ID);
    });

    it('detects a rotation error when handles imply rotation=2 but stored rotation=0', () => {
      const store = useRoomStore();
      syncWithHandles(store, T_SHAPE_ROT2, 0);
      expect(store.rotationErrors).toContain(ZONE_ID);
    });

    it('detects a rotation error when handles imply rotation=0 but stored rotation=2', () => {
      const store = useRoomStore();
      syncWithHandles(store, T_SHAPE_DEFAULT, 2);
      expect(store.rotationErrors).toContain(ZONE_ID);
    });

    it('clears rotation error after clearRotationError is called', () => {
      const store = useRoomStore();
      syncWithHandles(store, T_SHAPE_ROT2, 0);
      expect(store.rotationErrors).toContain(ZONE_ID);

      store.clearRotationError(ZONE_ID);
      expect(store.rotationErrors).not.toContain(ZONE_ID);
    });

    it('clears rotation error on next sync if handles now match stored rotation', () => {
      const store = useRoomStore();
      // First sync: mismatch
      syncWithHandles(store, T_SHAPE_ROT2, 0);
      expect(store.rotationErrors).toContain(ZONE_ID);

      // Second sync: corrected
      syncWithHandles(store, T_SHAPE_DEFAULT, 0);
      expect(store.rotationErrors).not.toContain(ZONE_ID);
    });

    it('does not flag a zone with no customHandles', () => {
      const store = useRoomStore();
      store.applyMessage({
        type: 'sync',
        connections: [],
        homeZoneId: 'home',
        nodePositions: [
          { zoneId: 'home', x: 0, y: 0 },
          { zoneId: ZONE_ID, x: 10, y: 10, rotation: 0 },
        ],
        lastUpdatedAt: new Date().toISOString(),
        watching: 0, totalConnected: 0,
      });
      expect(store.rotationErrors).not.toContain(ZONE_ID);
    });
  });

  describe('session_expired message', () => {
    it('sets wsStatus to auth_failed when session_expired is received', () => {
      const store = useRoomStore();
      store.setCredentials('room1', 'some-token');

      store.applyMessage({ type: 'session_expired', reason: 'Session expired, please log in again' });

      expect(store.wsStatus).toBe('auth_failed');
    });

    it('sets disconnectReason to session_expired when session_expired is received', () => {
      const store = useRoomStore();
      store.setCredentials('room1', 'some-token');

      store.applyMessage({ type: 'session_expired', reason: 'Session expired, please log in again' });

      expect(store.disconnectReason).toBe('session_expired');
    });

    it('removes the stored token from localStorage when session_expired is received', () => {
      const store = useRoomStore();
      store.setCredentials('room1', 'some-token');

      store.applyMessage({ type: 'session_expired', reason: 'Session expired, please log in again' });

      expect(localStorage.getItem('token:room1')).toBeNull();
    });
  });

  describe('token live-read from localStorage', () => {
    it('setCredentials writes the token to localStorage so token computed reflects it', () => {
      const store = useRoomStore();
      store.setCredentials('room1', 'my-jwt');
      expect(localStorage.getItem('token:room1')).toBe('my-jwt');
      expect(store.token).toBe('my-jwt');
    });

    it('token computed returns empty string when localStorage entry is absent', () => {
      const store = useRoomStore();
      store.setCredentials('room1', 'my-jwt');
      localStorage.removeItem('token:room1');
      expect(store.token).toBe('');
    });

    it('send() triggers session_expired flow when the token has been removed from localStorage', () => {
      const store = useRoomStore();
      store.setCredentials('room1', 'my-jwt');

      // Simulate token deletion (e.g. user cleared storage in another tab or admin action)
      localStorage.removeItem('token:room1');

      store.send({ type: 'update_plot_route', plottedRoute: [] });

      expect(store.wsStatus).toBe('auth_failed');
      expect(store.disconnectReason).toBe('session_expired');
      expect(localStorage.getItem('token:room1')).toBeNull();
    });

    it('send() blocks update_node_positions when the token has been removed from localStorage', () => {
      const store = useRoomStore();
      store.setCredentials('room1', 'my-jwt');

      localStorage.removeItem('token:room1');

      store.send({ type: 'update_node_positions', nodePositions: [] });

      expect(store.wsStatus).toBe('auth_failed');
      expect(store.disconnectReason).toBe('session_expired');
    });

    it('connect() triggers session_expired flow when the token is absent from localStorage', () => {
      const store = useRoomStore();
      // Set roomId without a token in localStorage
      store.setCredentials('room1', 'my-jwt');
      localStorage.removeItem('token:room1');

      store.connect();

      expect(store.wsStatus).toBe('auth_failed');
      expect(store.disconnectReason).toBe('session_expired');
    });
  });

  it('marks an edge as isolated when parent connection expires', () => {
    const store = useRoomStore();
    const now = Date.now();
    
    // Parent expires in 2s
    const parentExpiresAt = new Date(now + 2000).toISOString();
    // Child expires in 10m
    const childExpiresAt = new Date(now + 600000).toISOString();
    
    store.applyMessage({
      type: 'sync',
      connections: [
        { id: 'parent', roomId: 'r1', fromZoneId: 'home', toZoneId: 'a', expiresAt: parentExpiresAt, reportedAt: new Date().toISOString() },
        { id: 'child', roomId: 'r1', fromZoneId: 'a', toZoneId: 'b', expiresAt: childExpiresAt, reportedAt: new Date().toISOString() }
      ],
      homeZoneId: 'home',
      nodePositions: [{ zoneId: 'home', x: 0, y: 0 }, { zoneId: 'a', x: 10, y: 10 }, { zoneId: 'b', x: 20, y: 20 }],
      lastUpdatedAt: new Date().toISOString(),
      watching: 0, totalConnected: 0
    });

    // Check at 1s (before expiry)
    expect(store.isEdgeIsolated('child', now + 1000)).toBe(false);

    // Check at 3s (after expiry)
    expect(store.isEdgeIsolated('child', now + 3000)).toBe(true);
  });
});
