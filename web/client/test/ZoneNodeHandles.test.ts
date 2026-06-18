import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ZoneNodeHandles from '../src/components/flow/ZoneNodeHandles.vue';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import { useRoomStore } from '../src/stores/useRoomStore';
import { Position } from '@vue-flow/core';
import type { CustomHandle } from 'shared';

// A minimal set of handles: center, center-overlay, and one edge handle
const BASIC_HANDLES: CustomHandle[] = [
  { id: 'center', left: '50%', top: '50%', position: Position.Right },
  { id: 'center-overlay', left: '50%', top: '50%', position: Position.Right },
  { id: 'n', left: '50%', top: '0%', position: Position.Top },
];

function mountHandles(
  nodeId: string,
  nodeType: string,
  handles: CustomHandle[] = BASIC_HANDLES,
  isRestricted = false,
) {
  return mount(ZoneNodeHandles, {
    props: { nodeId, nodeType, handles, isRestricted, now: Date.now() },
    global: {
      stubs: {
        Handle: { template: '<div class="vue-flow__handle" v-bind="$attrs" />', inheritAttrs: false },
      },
    },
  });
}

function syncStore(store: ReturnType<typeof useRoomStore>, overrides: {
  nodePositions?: { zoneId: string; x: number; y: number; chainId: string }[];
  connections?: any[];
} = {}) {
  store.applyMessage({
    type: 'sync',
    connections: overrides.connections ?? [],
    homeZoneId: 'zone-a',
    nodePositions: overrides.nodePositions ?? [],
    lastUpdatedAt: new Date().toISOString(),
    watching: 0,
    totalConnected: 0,
  });
}

describe('ZoneNodeHandles', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('handle visibility — not connecting', () => {
    it('renders all handles at full opacity when not connecting', async () => {
      const store = useRoomStore();
      store.setCredentials('room1', 'token1');
      syncStore(store, {
        nodePositions: [
          { zoneId: 'zone-a', x: 0, y: 0, chainId: 'chain-1' },
          { zoneId: 'zone-b', x: 100, y: 0, chainId: 'chain-2' },
        ],
      });
      store.isConnecting = false;

      const wrapper = mountHandles('zone-b', 'roads');
      await nextTick();

      const handles = wrapper.findAll('.vue-flow__handle');
      expect(handles.length).toBeGreaterThan(0);
      handles.forEach(h => {
        expect(h.attributes('style') ?? '').not.toContain('opacity: 0.25');
      });
    });
  });

  describe('handle visibility — outside source chain', () => {
    it('hides non-center-overlay handles on outside-chain nodes while dragging', async () => {
      const store = useRoomStore();
      store.setCredentials('room1', 'token1');
      syncStore(store, {
        nodePositions: [
          { zoneId: 'zone-a', x: 0, y: 0, chainId: 'chain-1' },
          { zoneId: 'zone-b', x: 100, y: 0, chainId: 'chain-2' },
        ],
      });
      store.isConnecting = true;
      store.connectingSourceNodeId = 'zone-a';

      const wrapper = mountHandles('zone-b', 'roads');
      await nextTick();

      // Only center-overlay should be visible; other handles hidden
      const allHandles = wrapper.findAll('.vue-flow__handle');
      const nonCenter = allHandles.filter(h => h.attributes('id') !== 'center-overlay');
      expect(nonCenter.length).toBe(0);

      const centerOverlay = wrapper.find('.vue-flow__handle[id="center-overlay"]');
      expect(centerOverlay.exists()).toBe(true);
    });

    it('shows connected handles at 0.25 opacity on outside-chain nodes', async () => {
      const now = Date.now();
      const store = useRoomStore();
      store.setCredentials('room1', 'token1');
      syncStore(store, {
        nodePositions: [
          { zoneId: 'zone-a', x: 0, y: 0, chainId: 'chain-1' },
          { zoneId: 'zone-b', x: 100, y: 0, chainId: 'chain-2' },
        ],
        connections: [{
          id: 'conn-1',
          roomId: 'room1',
          fromZoneId: 'zone-b',
          toZoneId: 'zone-c',
          fromHandleId: 'n',
          expiresAt: new Date(now + 3600000).toISOString(),
          reportedAt: new Date().toISOString(),
        }],
      });
      store.isConnecting = true;
      store.connectingSourceNodeId = 'zone-a';

      const wrapper = mountHandles('zone-b', 'roads');
      await nextTick();

      // The connected handle 'n' should be visible at 0.25 opacity
      const connectedHandle = wrapper.find('.vue-flow__handle[id="n"]');
      expect(connectedHandle.exists()).toBe(true);
      expect(connectedHandle.attributes('style') ?? '').toContain('opacity: 0.25');
    });

    it('shows handles at full opacity on same-chain nodes while dragging', async () => {
      const store = useRoomStore();
      store.setCredentials('room1', 'token1');
      syncStore(store, {
        nodePositions: [
          { zoneId: 'zone-a', x: 0, y: 0, chainId: 'chain-1' },
          { zoneId: 'zone-b', x: 100, y: 0, chainId: 'chain-1' },
        ],
      });
      store.isConnecting = true;
      store.connectingSourceNodeId = 'zone-a';

      const wrapper = mountHandles('zone-b', 'roads');
      await nextTick();

      const handles = wrapper.findAll('.vue-flow__handle');
      expect(handles.length).toBeGreaterThan(0);
      handles.forEach(h => {
        expect(h.attributes('style') ?? '').not.toContain('opacity: 0.25');
      });
    });

    it('restores handles to full opacity after dragging ends', async () => {
      const now = Date.now();
      const store = useRoomStore();
      store.setCredentials('room1', 'token1');
      syncStore(store, {
        nodePositions: [
          { zoneId: 'zone-a', x: 0, y: 0, chainId: 'chain-1' },
          { zoneId: 'zone-b', x: 100, y: 0, chainId: 'chain-2' },
        ],
        connections: [{
          id: 'conn-1',
          roomId: 'room1',
          fromZoneId: 'zone-b',
          toZoneId: 'zone-c',
          fromHandleId: 'n',
          expiresAt: new Date(now + 3600000).toISOString(),
          reportedAt: new Date().toISOString(),
        }],
      });

      store.isConnecting = true;
      store.connectingSourceNodeId = 'zone-a';

      const wrapper = mountHandles('zone-b', 'roads');
      await nextTick();

      // During drag: connected handle dimmed
      const handleDuring = wrapper.find('.vue-flow__handle[id="n"]');
      expect(handleDuring.attributes('style') ?? '').toContain('opacity: 0.25');

      // End drag
      store.isConnecting = false;
      store.connectingSourceNodeId = null;
      await nextTick();

      // After drag: full opacity restored
      const handleAfter = wrapper.find('.vue-flow__handle[id="n"]');
      expect(handleAfter.attributes('style') ?? '').not.toContain('opacity: 0.25');
    });
  });

});
