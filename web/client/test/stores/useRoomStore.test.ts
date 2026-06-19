import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import { useRoomStore } from '../../src/stores/useRoomStore';


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
