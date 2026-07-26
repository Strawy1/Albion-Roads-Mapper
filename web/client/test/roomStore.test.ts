import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useRoomStore } from '../src/stores/useRoomStore.js';
import type { Connection } from 'shared';

function makeConn(id: string, roomId = 'room1'): Connection {
  return {
    id,
    roomId,
    fromZoneId: 'adrens-hill',
    toZoneId: 'anklesnag-mire',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    reportedAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('useRoomStore', () => {
  it('applies sync message — sets connections and homeZoneId', () => {
    const store = useRoomStore();
    const conn = makeConn('c1');
    store.applyMessage({ 
      type: 'sync', 
      connections: [conn], 
      homeZoneId: 'zone-a',
      nodePositions: [],
      lastUpdatedAt: new Date().toISOString(),
      watching: 0, totalConnected: 0
    });

    expect(store.connections).toHaveLength(1);
    expect(store.connections[0].id).toBe('c1');
    expect(store.homeZoneId).toBe('zone-a');
  });

  it('applies connection_added — adds to list', () => {
    const store = useRoomStore();
    const conn = makeConn('c1');
    store.applyMessage({ type: 'connection_added', connection: conn });

    expect(store.connections).toHaveLength(1);
    expect(store.connections[0].id).toBe('c1');
  });

  it('connection_added is idempotent — duplicate id is a no-op', () => {
    const store = useRoomStore();
    const conn = makeConn('c1');
    store.applyMessage({ type: 'connection_added', connection: conn });
    store.applyMessage({ type: 'connection_added', connection: conn });

    expect(store.connections).toHaveLength(1);
  });

  it('applies connection_removed — removes from list', () => {
    const store = useRoomStore();
    store.applyMessage({ type: 'connection_added', connection: makeConn('c1') });
    store.applyMessage({ type: 'connection_added', connection: makeConn('c2') });
    store.applyMessage({ type: 'connection_removed', connectionId: 'c1' });

    expect(store.connections).toHaveLength(1);
    expect(store.connections[0].id).toBe('c2');
  });

  it('applies a batched connection_removed — removes every id and orphaned zone in one message', () => {
    const store = useRoomStore();
    store.applyMessage({
      type: 'sync',
      connections: [makeConn('c1'), makeConn('c2'), makeConn('c3'), makeConn('c4')],
      homeZoneId: 'zone-a',
      nodePositions: [
        { zoneId: 'zone-a', x: 0, y: 0 },
        { zoneId: 'zone-b', x: 100, y: 0 },
        { zoneId: 'zone-c', x: 200, y: 0 },
      ],
      lastUpdatedAt: new Date().toISOString(),
      watching: 0, totalConnected: 0,
    });

    // One bulk-delete broadcast prunes a whole branch
    store.applyMessage({
      type: 'connection_removed',
      connectionIds: ['c1', 'c2', 'c3'],
      removedZoneIds: ['zone-b', 'zone-c'],
    });

    expect(store.connections.map(c => c.id)).toEqual(['c4']);
    expect(store.nodePositions.map(p => p.zoneId)).toEqual(['zone-a']);
  });

  it('batched connection_removed tolerates ids that are already gone', () => {
    const store = useRoomStore();
    store.applyMessage({ type: 'connection_added', connection: makeConn('c1') });
    store.applyMessage({ type: 'connection_removed', connectionIds: ['c1', 'never-existed'] });

    expect(store.connections).toHaveLength(0);
  });

  it('connection_removed for unknown id is a no-op', () => {
    const store = useRoomStore();
    store.applyMessage({ type: 'connection_added', connection: makeConn('c1') });
    store.applyMessage({ type: 'connection_removed', connectionId: 'does-not-exist' });

    expect(store.connections).toHaveLength(1);
  });

  it('chain_removed drops the chain, its links and its zones — including ones the server only found by zone membership', () => {
    const store = useRoomStore();
    store.applyMessage({
      type: 'sync',
      connections: [makeConn('k1'), makeConn('k2'), makeConn('ghost-edge'), makeConn('other-chain')],
      homeZoneId: 'home',
      nodePositions: [
        { zoneId: 'home', x: 0, y: 0, chainId: 'ch1' },
        { zoneId: 's1', x: 100, y: 0, chainId: 'ch2' },
        { zoneId: 'x', x: 200, y: 0, chainId: 'ch2' },
        // No chainId at all — the row the server used to leave behind. It now
        // arrives in removedZoneIds, so the client must drop it too.
        { zoneId: 'ghost', x: 300, y: 0 },
        { zoneId: 'o1', x: -100, y: 0, chainId: 'ch3' },
      ],
      chains: [
        { id: 'ch1', sourceZoneId: 'home', chainNumber: 1, chainColor: '#fff' },
        { id: 'ch2', sourceZoneId: 's1', chainNumber: 2, chainColor: '#3b82f6' },
        { id: 'ch3', sourceZoneId: 'o1', chainNumber: 3, chainColor: '#f00' },
      ],
      lastUpdatedAt: new Date().toISOString(),
      watching: 0, totalConnected: 0,
    });

    store.applyMessage({
      type: 'chain_removed',
      chainId: 'ch2',
      removedZoneIds: ['s1', 'x', 'ghost'],
      removedConnectionIds: ['k1', 'k2', 'ghost-edge'],
    });

    expect(store.chains.map(c => c.id)).toEqual(['ch1', 'ch3']);
    expect(store.nodePositions.map(p => p.zoneId)).toEqual(['home', 'o1']);
    expect(store.connections.map(c => c.id)).toEqual(['other-chain']);
  });

  it('chain_relocated wipes the old chain\'s links and zones and seats the new source', () => {
    const store = useRoomStore();
    store.applyMessage({
      type: 'sync',
      connections: [makeConn('k1'), makeConn('k2'), makeConn('keep')],
      homeZoneId: 'home',
      nodePositions: [
        { zoneId: 'home', x: 0, y: 0, chainId: 'ch1' },
        { zoneId: 's1', x: 100, y: 0, chainId: 'ch2' },
        { zoneId: 'x', x: 200, y: 0, chainId: 'ch2' },
      ],
      chains: [
        { id: 'ch1', sourceZoneId: 'home', chainNumber: 1, chainColor: '#fff' },
        { id: 'ch2', sourceZoneId: 's1', chainNumber: 2, chainColor: '#3b82f6' },
      ],
      lastUpdatedAt: new Date().toISOString(),
      watching: 0, totalConnected: 0,
    });

    // Relocating deletes every link in the chain — they may no longer be valid
    // once the chain is re-rooted, and the server cannot tell which still are.
    store.applyMessage({
      type: 'chain_relocated',
      chain: { id: 'ch2', sourceZoneId: 'new-source', chainNumber: 2, chainColor: '#3b82f6' },
      removedZoneIds: ['s1', 'x'],
      removedConnectionIds: ['k1', 'k2'],
      newSourceNodePosition: { zoneId: 'new-source', x: 100, y: 0, chainId: 'ch2' },
    });

    expect(store.chains.find(c => c.id === 'ch2')!.sourceZoneId).toBe('new-source');
    expect(store.connections.map(c => c.id)).toEqual(['keep']);
    expect(store.nodePositions.map(p => p.zoneId)).toEqual(['home', 'new-source']);
  });

  it('applies connection_expired — marks connection as expired', () => {
    const store = useRoomStore();
    store.applyMessage({ type: 'connection_added', connection: makeConn('c1') });
    store.applyMessage({ type: 'connection_expired', connectionId: 'c1' });

    expect(store.connections).toHaveLength(1);
    expect(store.connections[0].isExpired).toBe(true);
  });

  it('applies room_updated — changes homeZoneId', () => {
    const store = useRoomStore();
    store.applyMessage({ 
      type: 'sync', 
      connections: [], 
      homeZoneId: 'zone-a',
      nodePositions: [],
      lastUpdatedAt: new Date().toISOString(),
      watching: 0, totalConnected: 0
    });
    store.applyMessage({ type: 'room_updated', homeZoneId: 'zone-b' });

    expect(store.homeZoneId).toBe('zone-b');
  });

  it('room_updated is idempotent — same homeZoneId applied twice is fine', () => {
    const store = useRoomStore();
    store.applyMessage({ type: 'room_updated', homeZoneId: 'zone-a' });
    store.applyMessage({ type: 'room_updated', homeZoneId: 'zone-a' });

    expect(store.homeZoneId).toBe('zone-a');
  });
});
