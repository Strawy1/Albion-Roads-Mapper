import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Connection } from 'shared';
import { useRoomStore } from '@/stores/useRoomStore';

export type PlotRouteStep = 'idle' | 'selectingFrom' | 'selectingTo';

export const usePlotRouteStore = defineStore('plotRoute', () => {
  const step = ref<PlotRouteStep>('idle');
  const fromZoneId = ref<string | null>(null);
  const toZoneId = ref<string | null>(null);
  const chainId = ref<string | null>(null);
  const plottedConnectionIds = ref<Set<string>>(new Set());
  /** Connections that are traversed backwards (user start→end opposes conn.fromZoneId→conn.toZoneId) */
  const reversedConnectionIds = ref<Set<string>>(new Set());
  /** Zone currently hovered during selectingTo step, used for ghost preview */
  const hoveredToZoneId = ref<string | null>(null);
  /** Ghost preview connection IDs while hovering during selectingTo */
  const ghostConnectionIds = ref<Set<string>>(new Set());
  /** Ghost preview reversed connection IDs */
  const ghostReversedConnectionIds = ref<Set<string>>(new Set());

  // Derived state for backward-compatible consumers
  const isPlotRouteMode = computed(() => step.value !== 'idle');
  const isSelectingFrom = computed(() => step.value === 'selectingFrom');
  const isSelectingTo = computed(() => step.value === 'selectingTo');
  const hasRoute = computed(() => plottedConnectionIds.value.size > 0);

  function sendRouteUpdate(ids: string[]) {
    try {
      const roomStore = useRoomStore();
      roomStore.send({
        type: 'update_plot_route',
        plottedRoute: ids,
        fromZoneId: fromZoneId.value ?? undefined,
        toZoneId: toZoneId.value ?? undefined,
        chainId: chainId.value ?? undefined,
      });
    } catch (e) {
      console.error('[PlotRoute] sendRouteUpdate error', e);
    }
  }

  function enterPlotRouteMode() {
    step.value = 'selectingFrom';
    fromZoneId.value = null;
    toZoneId.value = null;
    chainId.value = null;
    plottedConnectionIds.value = new Set();
    reversedConnectionIds.value = new Set();
    hoveredToZoneId.value = null;
    ghostConnectionIds.value = new Set();
    ghostReversedConnectionIds.value = new Set();
  }

  function exitPlotRouteMode() {
    step.value = 'idle';
    fromZoneId.value = null;
    toZoneId.value = null;
    chainId.value = null;
    plottedConnectionIds.value = new Set();
    reversedConnectionIds.value = new Set();
    hoveredToZoneId.value = null;
    ghostConnectionIds.value = new Set();
    ghostReversedConnectionIds.value = new Set();
    sendRouteUpdate([]);
  }

  /**
   * BFS from startZoneId to endZoneId.
   * Returns { connectionIds, reversedIds } where reversedIds are connections
   * traversed against their natural fromZoneId→toZoneId direction.
   */
  function bfsRoute(startZoneId: string, endZoneId: string, connections: Connection[]): { connectionIds: string[]; reversedIds: string[] } | null {
    if (startZoneId === endZoneId) return { connectionIds: [], reversedIds: [] };

    // Build adjacency: zoneId -> list of {connectionId, neighborZoneId, reversed}
    const adj = new Map<string, { connectionId: string; neighborZoneId: string; reversed: boolean }[]>();
    for (const conn of connections) {
      if (!adj.has(conn.fromZoneId)) adj.set(conn.fromZoneId, []);
      adj.get(conn.fromZoneId)!.push({ connectionId: conn.id, neighborZoneId: conn.toZoneId, reversed: false });
      if (!adj.has(conn.toZoneId)) adj.set(conn.toZoneId, []);
      adj.get(conn.toZoneId)!.push({ connectionId: conn.id, neighborZoneId: conn.fromZoneId, reversed: true });
    }

    // BFS
    const visited = new Set<string>();
    const queue: { zoneId: string; path: string[]; reversed: string[] }[] = [{ zoneId: startZoneId, path: [], reversed: [] }];
    visited.add(startZoneId);

    while (queue.length > 0) {
      const { zoneId, path, reversed } = queue.shift()!;

      if (zoneId === endZoneId) {
        return { connectionIds: path, reversedIds: reversed };
      }

      const neighbors = adj.get(zoneId) || [];
      for (const { connectionId, neighborZoneId, reversed: isReversed } of neighbors) {
        if (!visited.has(neighborZoneId)) {
          visited.add(neighborZoneId);
          queue.push({
            zoneId: neighborZoneId,
            path: [...path, connectionId],
            reversed: isReversed ? [...reversed, connectionId] : reversed,
          });
        }
      }
    }

    return null;
  }

  function computeRoute(startZoneId: string, endZoneId: string, connections: Connection[]) {
    const result = bfsRoute(startZoneId, endZoneId, connections);
    if (result) {
      plottedConnectionIds.value = new Set(result.connectionIds);
      reversedConnectionIds.value = new Set(result.reversedIds);
    } else {
      plottedConnectionIds.value = new Set();
      reversedConnectionIds.value = new Set();
    }
  }

  /**
   * Compute a ghost preview route from fromZoneId to hoveredZoneId without committing it.
   * Used to show ghost edges while hovering during selectingTo.
   */
  function updateGhostPreview(hoveredZoneId: string | null, connections: Connection[]) {
    hoveredToZoneId.value = hoveredZoneId;
    if (!hoveredZoneId || !fromZoneId.value || step.value !== 'selectingTo') {
      ghostConnectionIds.value = new Set();
      ghostReversedConnectionIds.value = new Set();
      return;
    }
    const result = bfsRoute(fromZoneId.value, hoveredZoneId, connections);
    if (result) {
      ghostConnectionIds.value = new Set(result.connectionIds);
      ghostReversedConnectionIds.value = new Set(result.reversedIds);
    } else {
      ghostConnectionIds.value = new Set();
      ghostReversedConnectionIds.value = new Set();
    }
  }

  /**
   * Called when the user clicks a zone during route plotting.
   * Step 1 (selectingFrom): pick the start zone and advance to selectingTo.
   * Step 2 (selectingTo): pick the end zone, compute route, and finish.
   * Zones must share the same chainId; cross-chain selection is rejected.
   */
  function selectZone(clickedZoneId: string, clickedChainId: string | null | undefined, connections: Connection[]) {
    if (step.value === 'selectingFrom') {
      fromZoneId.value = clickedZoneId;
      chainId.value = clickedChainId ?? null;
      step.value = 'selectingTo';
      return;
    }

    if (step.value === 'selectingTo') {
      // Enforce same-chain constraint
      if ((clickedChainId ?? null) !== chainId.value) {
        return;
      }
      toZoneId.value = clickedZoneId;

      if (fromZoneId.value) {
        computeRoute(fromZoneId.value, clickedZoneId, connections);
      }

      step.value = 'idle';
      hoveredToZoneId.value = null;
      ghostConnectionIds.value = new Set();
      ghostReversedConnectionIds.value = new Set();
      sendRouteUpdate(Array.from(plottedConnectionIds.value));
    }
  }

  /** Called when a connection is removed — clears route if it was part of the plotted path */
  function onConnectionRemoved(connectionId: string) {
    if (plottedConnectionIds.value.has(connectionId)) {
      step.value = 'idle';
      fromZoneId.value = null;
      toZoneId.value = null;
      chainId.value = null;
      plottedConnectionIds.value = new Set();
      reversedConnectionIds.value = new Set();
      hoveredToZoneId.value = null;
      ghostConnectionIds.value = new Set();
      ghostReversedConnectionIds.value = new Set();
      sendRouteUpdate([]);
    }
  }

  /** Called when a node (zone) is deleted — clears route if start or end was that zone */
  function onNodeRemoved(zoneId: string) {
    if (fromZoneId.value === zoneId || toZoneId.value === zoneId) {
      step.value = 'idle';
      fromZoneId.value = null;
      toZoneId.value = null;
      chainId.value = null;
      plottedConnectionIds.value = new Set();
      reversedConnectionIds.value = new Set();
      hoveredToZoneId.value = null;
      ghostConnectionIds.value = new Set();
      ghostReversedConnectionIds.value = new Set();
      sendRouteUpdate([]);
    }
  }

  /** Apply a plotted route received from the server (sync/broadcast) */
  function applyPlottedRoute(connectionIds: string[], appliedFromZoneId?: string, appliedToZoneId?: string, appliedChainId?: string) {
    plottedConnectionIds.value = new Set(connectionIds);
    reversedConnectionIds.value = new Set();
    hoveredToZoneId.value = null;
    ghostConnectionIds.value = new Set();
    ghostReversedConnectionIds.value = new Set();
    if (connectionIds.length === 0) {
      step.value = 'idle';
      fromZoneId.value = null;
      toZoneId.value = null;
      chainId.value = null;
    } else {
      fromZoneId.value = appliedFromZoneId ?? null;
      toZoneId.value = appliedToZoneId ?? null;
      chainId.value = appliedChainId ?? null;
    }
  }

  return {
    step,
    isPlotRouteMode,
    isSelectingFrom,
    isSelectingTo,
    fromZoneId,
    toZoneId,
    chainId,
    plottedConnectionIds,
    reversedConnectionIds,
    hoveredToZoneId,
    ghostConnectionIds,
    ghostReversedConnectionIds,
    hasRoute,
    enterPlotRouteMode,
    exitPlotRouteMode,
    selectZone,
    updateGhostPreview,
    onConnectionRemoved,
    onNodeRemoved,
    applyPlottedRoute,
  };
});
