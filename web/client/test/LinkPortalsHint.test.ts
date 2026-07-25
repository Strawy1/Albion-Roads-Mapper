import { mount } from '@vue/test-utils';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { ref } from 'vue';
import { useRoomStore } from '../src/stores/useRoomStore';
import ConnectionEdge from '../src/components/flow/ConnectionEdge.vue';

vi.mock('@vue-flow/core', async () => {
  const actual = await vi.importActual<any>('@vue-flow/core');
  return {
    ...actual,
    BaseEdge: {
      name: 'BaseEdge',
      template: '<div class="base-edge"></div>',
      props: ['animated', 'path', 'id', 'style'],
    },
    EdgeLabelRenderer: { template: '<div><slot/></div>' },
    useVueFlow: () => ({
      setCenter: vi.fn(),
      getNode: vi.fn(() => ({ position: { x: 0, y: 0 } })),
      onNodeDrag: vi.fn(),
      onNodeDragStop: vi.fn(),
      viewport: ref({ x: 0, y: 0, zoom: 1 }),
    }),
  };
});

const expiresAt = new Date(Date.now() + 600000).toISOString();

function syncStore() {
  const store = useRoomStore();
  store.applyMessage({
    type: 'sync',
    connections: [
      { id: 'child', roomId: 'r1', fromZoneId: 'a', toZoneId: 'b', expiresAt, reportedAt: new Date().toISOString() },
    ],
    homeZoneId: 'a',
    nodePositions: [{ zoneId: 'a', x: 0, y: 0 }, { zoneId: 'b', x: 10, y: 10 }],
    lastUpdatedAt: new Date().toISOString(),
    watching: 0, totalConnected: 0,
  } as any);
  return store;
}

function mountEdge() {
  return mount(ConnectionEdge, {
    props: {
      id: 'child',
      sourceX: 0, sourceY: 0, targetX: 10, targetY: 10,
      data: {
        connection: { id: 'child', roomId: 'r1', fromZoneId: 'a', toZoneId: 'b', expiresAt, reportedAt: new Date().toISOString(), isExpired: false },
        now: Date.now(),
      },
      sourceNode: { computedPosition: { x: 0, y: 0 }, dimensions: { width: 0, height: 0 }, handleBounds: {} } as any,
      // Unexplored target — this is what triggers the "Link Zone portals!" hint
      targetNode: { type: 'zone', data: { explored: false }, computedPosition: { x: 10, y: 10 }, dimensions: { width: 0, height: 0 }, handleBounds: {} } as any,
      source: 'a', target: 'b', type: 'default',
      sourcePosition: 'top' as any, targetPosition: 'bottom' as any,
      markerStart: '', markerEnd: '',
      events: {} as any,
    },
    global: { provide: { openPopoverId: ref(null) } },
  });
}

describe('Link Zone portals hint', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('shows on an unexplored target, with the opt-out collapsed until hovered', async () => {
    syncStore();
    const wrapper = mountEdge();

    expect(wrapper.text()).toContain('Link Zone portals!');

    const optOut = wrapper.find('.dismiss-all-btn');
    expect(optOut.exists()).toBe(true);
    // Collapsed at rest so the bubble stays one line on a crowded map
    expect(optOut.element.closest('.overflow-hidden')?.className).toContain('max-h-0');

    await wrapper.find('.animate-bounce-prompt, .relative.bg-blue-600').trigger('mouseenter');
    expect(optOut.element.closest('.overflow-hidden')?.className).toContain('max-h-10');
  });

  it('dismissing with ✕ persists for that connection across remounts', async () => {
    syncStore();
    const wrapper = mountEdge();

    await wrapper.find('.dismiss-btn').trigger('click');
    expect(wrapper.text()).not.toContain('Link Zone portals!');

    const remounted = mountEdge();
    expect(remounted.text()).not.toContain('Link Zone portals!');
  });

  it('"Don\'t show this again" turns the hint off globally without touching other hints', async () => {
    const store = syncStore();
    const wrapper = mountEdge();

    await wrapper.find('.animate-bounce-prompt, .relative.bg-blue-600').trigger('mouseenter');
    await wrapper.find('.dismiss-all-btn').trigger('click');

    expect(store.linkPortalsHintEnabled).toBe(false);
    expect(store.bluePromptsEnabled).toBe(true);
    expect(wrapper.text()).not.toContain('Link Zone portals!');

    // ...and it stays off for a fresh edge / reload
    expect(localStorage.getItem('linkPortalsHintEnabled')).toBe('false');
    expect(mountEdge().text()).not.toContain('Link Zone portals!');
  });

  it('prunes dismissals for connections that no longer exist', async () => {
    const store = syncStore();
    const wrapper = mountEdge();
    await wrapper.find('.dismiss-btn').trigger('click');
    expect(localStorage.getItem('linkPortalsHintDismissedIds')).toContain('child');

    store.applyMessage({
      type: 'sync',
      connections: [],
      homeZoneId: 'a',
      nodePositions: [],
      lastUpdatedAt: new Date().toISOString(),
      watching: 0, totalConnected: 0,
    } as any);

    expect(localStorage.getItem('linkPortalsHintDismissedIds')).toBe('[]');
  });
});
