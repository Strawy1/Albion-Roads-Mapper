/**
 * Regression tests for the hideout portal save flow.
 *
 * Bug: saving the ZoneHandleEditor on a hideout sent TWO WebSocket messages —
 * `rotate_zone` (whose server echo carried the STALE handles back to the
 * sender) followed by `update_node_positions` (whose broadcast EXCLUDED the
 * sender). The editing user's optimistic update was clobbered by the stale
 * echo and their view reverted to the old portals until a page reload.
 *
 * The fix sends handles + rotation as a single `rotate_zone` message; the
 * server echoes the authoritative row to every client including the sender.
 * These tests pin down the client half of that contract:
 *   1. Saving updates the local view immediately (optimistic).
 *   2. Exactly ONE message is sent, it is `rotate_zone`, and it carries the
 *      new customHandles (so the server can echo them back).
 *   3. No `update_node_positions` message is sent (the old racy path).
 *   4. The server echo re-applies cleanly on the sender's store.
 */

import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useRoomStore } from '@/stores/useRoomStore';

const sentFrames: any[] = [];

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = FakeWebSocket.OPEN;
  send(data: string) {
    sentFrames.push(JSON.parse(data));
  }
  close() {}
  addEventListener() {}
  removeEventListener() {}
}

const OLD_HANDLES = [{ id: 'custom-old', left: '75.00%', top: '25.00%' }];
const NEW_HANDLES = [
  { id: 'custom-a', left: '25.00%', top: '25.00%' },
  { id: 'custom-b', left: '75.00%', top: '75.00%' },
];

describe('hideout portal save — sender sees the change live', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    sentFrames.length = 0;
    vi.stubGlobal('WebSocket', FakeWebSocket as any);
  });

  function setupConnectedStore() {
    const store = useRoomStore();
    store.setCredentials('room1', 'token1');
    store.connect();
    store.applyMessage({
      type: 'sync',
      connections: [],
      homeZoneId: 'zone-home',
      nodePositions: [
        { zoneId: 'zone-home', x: 0, y: 0 },
        { zoneId: 'roads-hideout', x: 200, y: 0, customHandles: OLD_HANDLES, rotation: 0, explored: true },
      ],
      lastUpdatedAt: new Date().toISOString(),
      watching: 1,
      totalConnected: 1,
    });
    sentFrames.length = 0; // drop the auth frame
    return store;
  }

  it('applies the new handles to the local store immediately (optimistic)', () => {
    const store = setupConnectedStore();

    store.saveZoneHandles('roads-hideout', NEW_HANDLES, 0);

    const node = store.nodePositions.find(n => n.zoneId === 'roads-hideout');
    expect(node?.customHandles).toEqual(NEW_HANDLES);
    expect(node?.explored).toBe(true);
  });

  it('sends a single rotate_zone message carrying the new handles — and no update_node_positions', () => {
    const store = setupConnectedStore();

    store.saveZoneHandles('roads-hideout', NEW_HANDLES, 0);

    expect(sentFrames).toHaveLength(1);
    expect(sentFrames[0]).toEqual({
      type: 'rotate_zone',
      zoneId: 'roads-hideout',
      rotation: 0,
      customHandles: NEW_HANDLES,
    });
    // The old buggy flow sent update_node_positions as a second message whose
    // broadcast excluded the sender — it must not come back.
    expect(sentFrames.some(f => f.type === 'update_node_positions')).toBe(false);
  });

  it('falls back to the stored rotation when none is provided, so the server does not drop the save', () => {
    const store = setupConnectedStore();
    const node = store.nodePositions.find(n => n.zoneId === 'roads-hideout')!;
    node.rotation = 2;

    store.saveZoneHandles('roads-hideout', NEW_HANDLES);

    expect(sentFrames).toHaveLength(1);
    expect(sentFrames[0].rotation).toBe(2);
    expect(typeof sentFrames[0].rotation).toBe('number');
  });

  it('the authoritative server echo re-applies the saved handles on the sender', () => {
    const store = setupConnectedStore();

    store.saveZoneHandles('roads-hideout', NEW_HANDLES, 0);

    // The server broadcasts the saved row to ALL clients including the sender.
    store.applyMessage({
      type: 'node_positions_updated',
      nodePositions: [
        { zoneId: 'roads-hideout', x: 200, y: 0, customHandles: NEW_HANDLES, rotation: 0, explored: true },
      ],
      updateLastUpdated: true,
    });

    const node = store.nodePositions.find(n => n.zoneId === 'roads-hideout');
    expect(node?.customHandles).toEqual(NEW_HANDLES);
    // Other nodes are untouched by the single-row echo.
    expect(store.nodePositions.find(n => n.zoneId === 'zone-home')).toBeDefined();
  });
});
