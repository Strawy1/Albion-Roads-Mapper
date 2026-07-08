import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach } from 'vitest';
import { usePlotRouteStore } from '../src/stores/usePlotRouteStore';
import { useRoomStore } from '../src/stores/useRoomStore';

const makeConn = (id: string, from: string, to: string, chainId?: string) => ({
  id,
  roomId: 'room1',
  fromZoneId: from,
  toZoneId: to,
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  reportedAt: new Date().toISOString(),
  chainId,
});

/** Helper: simulate the two-step zone selection flow */
function twoStepSelect(
  store: ReturnType<typeof usePlotRouteStore>,
  fromZoneId: string,
  toZoneId: string,
  connections: ReturnType<typeof makeConn>[],
  chainId?: string
) {
  store.enterPlotRouteMode();
  store.selectZone(fromZoneId, chainId ?? null, connections);
  store.selectZone(toZoneId, chainId ?? null, connections);
}

describe('usePlotRouteStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('enters plot route mode in selectingFrom step', () => {
    const store = usePlotRouteStore();
    store.enterPlotRouteMode();
    expect(store.isPlotRouteMode).toBe(true);
    expect(store.isSelectingFrom).toBe(true);
    expect(store.isSelectingTo).toBe(false);
  });

  it('advances to selectingTo after first zone click', () => {
    const store = usePlotRouteStore();
    store.enterPlotRouteMode();
    store.selectZone('home', 'chain-1', []);
    expect(store.isSelectingFrom).toBe(false);
    expect(store.isSelectingTo).toBe(true);
    expect(store.fromZoneId).toBe('home');
    expect(store.chainId).toBe('chain-1');
  });

  it('exits mode and returns to idle after selecting end zone', () => {
    const store = usePlotRouteStore();
    const connections = [makeConn('c1', 'home', 'dest', 'chain-1')];
    twoStepSelect(store, 'home', 'dest', connections, 'chain-1');
    expect(store.isPlotRouteMode).toBe(false);
    expect(store.step).toBe('idle');
  });

  it('computes a route via BFS and sets plottedConnectionIds', () => {
    const store = usePlotRouteStore();
    const connections = [
      makeConn('c1', 'home', 'a', 'chain-1'),
      makeConn('c2', 'a', 'b', 'chain-1'),
      makeConn('c3', 'b', 'dest', 'chain-1'),
    ];
    twoStepSelect(store, 'home', 'dest', connections, 'chain-1');
    expect(store.plottedConnectionIds.has('c1')).toBe(true);
    expect(store.plottedConnectionIds.has('c2')).toBe(true);
    expect(store.plottedConnectionIds.has('c3')).toBe(true);
    expect(store.hasRoute).toBe(true);
  });

  it('stores fromZoneId and toZoneId after plotting', () => {
    const store = usePlotRouteStore();
    const connections = [makeConn('c1', 'home', 'dest', 'chain-1')];
    twoStepSelect(store, 'home', 'dest', connections, 'chain-1');
    expect(store.fromZoneId).toBe('home');
    expect(store.toZoneId).toBe('dest');
    expect(store.chainId).toBe('chain-1');
  });

  it('rejects cross-chain end zone selection (different chainId)', () => {
    const store = usePlotRouteStore();
    const connections = [
      makeConn('c1', 'home', 'a', 'chain-1'),
      makeConn('c2', 'b', 'dest', 'chain-2'),
    ];
    store.enterPlotRouteMode();
    store.selectZone('home', 'chain-1', connections);
    // Try to select an end zone from a different chain — should be ignored
    store.selectZone('dest', 'chain-2', connections);
    expect(store.isSelectingTo).toBe(true); // still in selectingTo step
    expect(store.toZoneId).toBeNull();
    expect(store.hasRoute).toBe(false);
  });

  it('accepts same-chain end zone selection', () => {
    const store = usePlotRouteStore();
    const connections = [makeConn('c1', 'home', 'dest', 'chain-1')];
    store.enterPlotRouteMode();
    store.selectZone('home', 'chain-1', connections);
    store.selectZone('dest', 'chain-1', connections);
    expect(store.hasRoute).toBe(true);
  });

  it('exits plot route mode on exit', () => {
    const store = usePlotRouteStore();
    store.enterPlotRouteMode();
    expect(store.isPlotRouteMode).toBe(true);
    store.exitPlotRouteMode();
    expect(store.isPlotRouteMode).toBe(false);
    expect(store.step).toBe('idle');
  });

  it('clears route when a plotted connection is removed', () => {
    const store = usePlotRouteStore();
    const connections = [makeConn('c1', 'home', 'dest', 'chain-1')];
    twoStepSelect(store, 'home', 'dest', connections, 'chain-1');
    expect(store.hasRoute).toBe(true);

    store.onConnectionRemoved('c1');

    expect(store.hasRoute).toBe(false);
    expect(store.isPlotRouteMode).toBe(false);
    expect(store.toZoneId).toBeNull();
    expect(store.fromZoneId).toBeNull();
  });

  it('does NOT clear route when an unrelated connection is removed', () => {
    const store = usePlotRouteStore();
    const connections = [makeConn('c1', 'home', 'dest', 'chain-1')];
    twoStepSelect(store, 'home', 'dest', connections, 'chain-1');
    expect(store.hasRoute).toBe(true);

    store.onConnectionRemoved('unrelated-id');

    expect(store.hasRoute).toBe(true);
  });

  it('clears route when the from zone is removed', () => {
    const store = usePlotRouteStore();
    const connections = [makeConn('c1', 'home', 'dest', 'chain-1')];
    twoStepSelect(store, 'home', 'dest', connections, 'chain-1');
    expect(store.hasRoute).toBe(true);

    store.onNodeRemoved('home');

    expect(store.hasRoute).toBe(false);
    expect(store.isPlotRouteMode).toBe(false);
    expect(store.fromZoneId).toBeNull();
  });

  it('clears route when the to zone is removed', () => {
    const store = usePlotRouteStore();
    const connections = [makeConn('c1', 'home', 'dest', 'chain-1')];
    twoStepSelect(store, 'home', 'dest', connections, 'chain-1');
    expect(store.hasRoute).toBe(true);

    store.onNodeRemoved('dest');

    expect(store.hasRoute).toBe(false);
    expect(store.isPlotRouteMode).toBe(false);
    expect(store.toZoneId).toBeNull();
  });

  it('does NOT clear route when an unrelated zone is removed', () => {
    const store = usePlotRouteStore();
    const connections = [makeConn('c1', 'home', 'dest', 'chain-1')];
    twoStepSelect(store, 'home', 'dest', connections, 'chain-1');
    expect(store.hasRoute).toBe(true);

    store.onNodeRemoved('some-other-zone');

    expect(store.hasRoute).toBe(true);
  });

  it('applies a plotted route from server sync', () => {
    const store = usePlotRouteStore();
    store.applyPlottedRoute(['c1', 'c2', 'c3']);
    expect(store.plottedConnectionIds.has('c1')).toBe(true);
    expect(store.plottedConnectionIds.has('c2')).toBe(true);
    expect(store.hasRoute).toBe(true);
  });

  it('applies a plotted route with from/to zones from server', () => {
    const store = usePlotRouteStore();
    store.applyPlottedRoute(['c1', 'c2'], 'from-zone', 'to-zone', 'chain-1');
    expect(store.plottedConnectionIds.has('c1')).toBe(true);
    expect(store.fromZoneId).toBe('from-zone');
    expect(store.toZoneId).toBe('to-zone');
    expect(store.chainId).toBe('chain-1');
  });

  it('clears state when applyPlottedRoute receives empty array', () => {
    const store = usePlotRouteStore();
    store.applyPlottedRoute(['c1']);
    store.applyPlottedRoute([]);
    expect(store.hasRoute).toBe(false);
    expect(store.isPlotRouteMode).toBe(false);
    expect(store.toZoneId).toBeNull();
    expect(store.fromZoneId).toBeNull();
  });

  it('room_reset message clears plot route via room store', () => {
    const store = usePlotRouteStore();
    store.applyPlottedRoute(['c1', 'c2']);
    expect(store.hasRoute).toBe(true);

    store.exitPlotRouteMode();

    expect(store.hasRoute).toBe(false);
    expect(store.isPlotRouteMode).toBe(false);
  });

  it('returns empty route when no path exists', () => {
    const store = usePlotRouteStore();
    const connections = [makeConn('c1', 'home', 'a', 'chain-1')];
    twoStepSelect(store, 'home', 'unreachable', connections, 'chain-1');
    expect(store.hasRoute).toBe(false);
    expect(store.plottedConnectionIds.size).toBe(0);
  });
});

describe('useRoomStore — plot route integration', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('connection_removed clears plot route if connection was plotted', () => {
    const roomStore = useRoomStore();
    const plotStore = usePlotRouteStore();

    // Manually set a plotted route
    plotStore.applyPlottedRoute(['conn-abc']);
    expect(plotStore.hasRoute).toBe(true);

    // Simulate connection_removed WS message
    roomStore.applyMessage({ type: 'connection_removed', connectionId: 'conn-abc' });

    expect(plotStore.hasRoute).toBe(false);
    expect(plotStore.isPlotRouteMode).toBe(false);
  });

  it('connection_removed does not clear plot route for unrelated connection', () => {
    const roomStore = useRoomStore();
    const plotStore = usePlotRouteStore();

    plotStore.applyPlottedRoute(['conn-abc']);
    expect(plotStore.hasRoute).toBe(true);

    roomStore.applyMessage({ type: 'connection_removed', connectionId: 'other-conn' });

    expect(plotStore.hasRoute).toBe(true);
  });

  it('room_reset clears plot route', () => {
    const roomStore = useRoomStore();
    const plotStore = usePlotRouteStore();

    plotStore.applyPlottedRoute(['conn-abc']);
    expect(plotStore.hasRoute).toBe(true);

    roomStore.applyMessage({ type: 'room_reset' });

    expect(plotStore.hasRoute).toBe(false);
    expect(plotStore.isPlotRouteMode).toBe(false);
  });

  it('plot_route_updated message applies route and zone info to plot store', () => {
    const roomStore = useRoomStore();
    const plotStore = usePlotRouteStore();

    roomStore.applyMessage({ 
      type: 'plot_route_updated', 
      plottedRoute: ['c1', 'c2'],
      fromZoneId: 'from-zone',
      toZoneId: 'dest-zone',
      chainId: 'chain-1',
    });

    expect(plotStore.plottedConnectionIds.has('c1')).toBe(true);
    expect(plotStore.plottedConnectionIds.has('c2')).toBe(true);
    expect(plotStore.fromZoneId).toBe('from-zone');
    expect(plotStore.toZoneId).toBe('dest-zone');
    expect(plotStore.chainId).toBe('chain-1');
    expect(plotStore.hasRoute).toBe(true);
  });

  it('sync message with plottedRoute applies route to plot store', () => {
    const roomStore = useRoomStore();
    const plotStore = usePlotRouteStore();

    roomStore.applyMessage({
      type: 'sync',
      connections: [],
      homeZoneId: 'home',
      nodePositions: [],
      lastUpdatedAt: new Date().toISOString(),
      watching: 0,
      totalConnected: 0,
      plottedRoute: ['c1', 'c2'],
    });

    expect(plotStore.plottedConnectionIds.has('c1')).toBe(true);
    expect(plotStore.hasRoute).toBe(true);
  });
});
