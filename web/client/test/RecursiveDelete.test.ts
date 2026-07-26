import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import RoomView from '../src/views/RoomView.vue';
import { useRoomStore } from '../src/stores/useRoomStore';
import { nextTick } from 'vue';
import * as roomOps from '../src/utils/roomOperations';

// Mock VueFlow and router
vi.mock('@vue-flow/core', () => ({
  useVueFlow: () => ({
    fitView: vi.fn(),
    updateNode: vi.fn(),
  }),
  VueFlow: { template: '<div><slot /></div>' },
  ConnectionMode: { Loose: 'loose' },
  BaseEdge: { template: '<div></div>' },
  EdgeLabelRenderer: { template: '<div><slot /></div>' },
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({
    replace: vi.fn(),
  }),
}));

// Mock roomOperations
vi.mock('../src/utils/roomOperations', () => ({
  deleteConnection: vi.fn(),
  deleteConnections: vi.fn(async () => ({ removedConnectionIds: [], removedZoneIds: [] })),
  updateConnection: vi.fn(),
}));

function makeConn(id: string, from: string, to: string) {
  return {
    id,
    roomId: 'room1',
    fromZoneId: from,
    toZoneId: to,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    reportedAt: new Date().toISOString(),
  };
}

describe('Recursive Delete', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it('correctly identifies connections with children and performs recursive delete', async () => {
    sessionStorage.setItem('token:room1', 'some-token');
    const store = useRoomStore();
    store.setCredentials('room1', 'some-token');

    // Setup A -> B -> C
    const conn1 = {
      id: 'c1',
      roomId: 'room1',
      fromZoneId: 'zone-a',
      toZoneId: 'zone-b',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      reportedAt: new Date().toISOString(),
    };
    const conn2 = {
      id: 'c2',
      roomId: 'room1',
      fromZoneId: 'zone-b',
      toZoneId: 'zone-c',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      reportedAt: new Date().toISOString(),
    };

    store.applyMessage({
      type: 'sync',
      connections: [conn1, conn2],
      homeZoneId: 'zone-a',
      nodePositions: [
        { zoneId: 'zone-a', x: 0, y: 0 },
        { zoneId: 'zone-b', x: 100, y: 0 },
        { zoneId: 'zone-c', x: 200, y: 0 },
      ],
      lastUpdatedAt: new Date().toISOString(),
      watching: 0, totalConnected: 0
    });

    const wrapper = mount(RoomView, {
      props: { id: 'room1' },
      global: {
        stubs: ['DebugTray', 'ReportForm', 'RoomSettings', 'Background', 'Controls']
      }
    });

    await nextTick();
    await nextTick();

    const vm = wrapper.vm as any;
    const edges = vm.flowEdges;

    expect(edges).toHaveLength(2);

    const edge1 = edges.find((e: any) => e.id === 'c1');
    const edge2 = edges.find((e: any) => e.id === 'c2');

    // Verify hasChildren
    expect(edge1.data.hasChildren).toBe(true);
    expect(edge2.data.hasChildren).toBe(false);

    // Trigger recursive delete on edge1
    await edge1.data.onDeleteRecursive('c1');

    // The whole branch must go in ONE request — a single bulk call carrying
    // both ids (leaf-to-root), not one round trip per connection.
    expect(roomOps.deleteConnection).not.toHaveBeenCalled();
    expect(roomOps.deleteConnections).toHaveBeenCalledTimes(1);
    expect(roomOps.deleteConnections).toHaveBeenCalledWith('room1', 'some-token', ['c2', 'c1']);

    wrapper.unmount();
  });

  it('stops at the loop and never touches a sibling branch', async () => {
    // Topology — a cycle with a branch hanging off it, plus an unrelated
    // sibling branch off the same source zone:
    //
    //   home ─c1─> B ─c2─> C ─c3─> D ─c4─> B     (c4 closes the loop)
    //                      └─c5─> E ─c6─> F     (branch off the loop)
    //   home ─c7─> G ─c8─> H                    (sibling branch — must survive)
    //
    // Deleting c1 must take exactly the six connections reachable from B,
    // walking the cycle once (c4 is removed, but D→B does NOT re-traverse B),
    // and must leave c7/c8 completely alone.
    sessionStorage.setItem('token:room1', 'some-token');
    const store = useRoomStore();
    store.setCredentials('room1', 'some-token');

    store.applyMessage({
      type: 'sync',
      connections: [
        makeConn('c1', 'home', 'zone-b'),
        makeConn('c2', 'zone-b', 'zone-c'),
        makeConn('c3', 'zone-c', 'zone-d'),
        makeConn('c4', 'zone-d', 'zone-b'), // loop back into the branch
        makeConn('c5', 'zone-c', 'zone-e'),
        makeConn('c6', 'zone-e', 'zone-f'),
        makeConn('c7', 'home', 'zone-g'), // sibling branch
        makeConn('c8', 'zone-g', 'zone-h'),
      ],
      homeZoneId: 'home',
      nodePositions: [
        { zoneId: 'home', x: 0, y: 0 },
        { zoneId: 'zone-b', x: 100, y: 0 },
        { zoneId: 'zone-c', x: 200, y: 0 },
        { zoneId: 'zone-d', x: 300, y: 0 },
        { zoneId: 'zone-e', x: 200, y: 100 },
        { zoneId: 'zone-f', x: 300, y: 100 },
        { zoneId: 'zone-g', x: -100, y: 0 },
        { zoneId: 'zone-h', x: -200, y: 0 },
      ],
      lastUpdatedAt: new Date().toISOString(),
      watching: 0, totalConnected: 0,
    });

    const wrapper = mount(RoomView, {
      props: { id: 'room1' },
      global: {
        stubs: ['DebugTray', 'ReportForm', 'RoomSettings', 'Background', 'Controls'],
      },
    });

    await nextTick();
    await nextTick();

    const edge1 = (wrapper.vm as any).flowEdges.find((e: any) => e.id === 'c1');
    await edge1.data.onDeleteRecursive('c1');

    expect(roomOps.deleteConnections).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(roomOps.deleteConnections).mock.calls[0][2];
    expect([...sent].sort()).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
    // The sibling branch is untouched — no over-deletion past the source zone.
    expect(sent).not.toContain('c7');
    expect(sent).not.toContain('c8');

    wrapper.unmount();
  });

  it('does not walk a loop back out into a zone that was never entered', async () => {
    // A cycle that re-enters the *source* zone: home → B → C → home.
    // Deleting c1 removes the cycle's connections but must not treat home's
    // other branch (c4) as part of the doomed set.
    //
    //   home ─c1─> B ─c2─> C ─c3─> home
    //   home ─c4─> G
    sessionStorage.setItem('token:room1', 'some-token');
    const store = useRoomStore();
    store.setCredentials('room1', 'some-token');

    store.applyMessage({
      type: 'sync',
      connections: [
        makeConn('c1', 'home', 'zone-b'),
        makeConn('c2', 'zone-b', 'zone-c'),
        makeConn('c3', 'zone-c', 'home'), // closes back onto the source
        makeConn('c4', 'home', 'zone-g'),
      ],
      homeZoneId: 'home',
      nodePositions: [
        { zoneId: 'home', x: 0, y: 0 },
        { zoneId: 'zone-b', x: 100, y: 0 },
        { zoneId: 'zone-c', x: 200, y: 0 },
        { zoneId: 'zone-g', x: -100, y: 0 },
      ],
      lastUpdatedAt: new Date().toISOString(),
      watching: 0, totalConnected: 0,
    });

    const wrapper = mount(RoomView, {
      props: { id: 'room1' },
      global: {
        stubs: ['DebugTray', 'ReportForm', 'RoomSettings', 'Background', 'Controls'],
      },
    });

    await nextTick();
    await nextTick();

    const edge1 = (wrapper.vm as any).flowEdges.find((e: any) => e.id === 'c1');
    await edge1.data.onDeleteRecursive('c1');

    const sent = vi.mocked(roomOps.deleteConnections).mock.calls[0][2];
    expect([...sent].sort()).toEqual(['c1', 'c2', 'c3']);
    expect(sent).not.toContain('c4');

    wrapper.unmount();
  });
});
