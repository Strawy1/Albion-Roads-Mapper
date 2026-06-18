import { defineStore } from 'pinia';
import { ref, computed, nextTick } from 'vue';
import type { Connection, ServerMessage, NodePosition, NodeFeatures, CustomHandle, RoomMemoryEntry, RoomChain } from 'shared';
import { inferRotationFromHandles, getShapeHandlePositions, ZONE_BY_ID, PRIMARY_CHAIN_COLOR } from 'shared';
import { API_BASE_URL } from '@/utils/api';
import { track } from '@vercel/analytics';
import { treeQuery } from '@/utils/treeQuery';
import { useRoomMemoryStore } from './useRoomMemoryStore';
import { usePlotRouteStore } from './usePlotRouteStore';

export type WsStatus = 'disconnected' | 'connecting' | 'connected' | 'auth_failed';
export type DisconnectReason = 'password_rotated' | 'room_deleted' | 'room_not_found' | 'session_expired' | null;

export const useRoomStore = defineStore('room', () => {
  const connections = ref<Connection[]>([]);
  const homeZoneId = ref<string>('');
  const chains = ref<RoomChain[]>([]);
  const chainSourceZoneIds = computed(() => new Set(chains.value.map(c => c.sourceZoneId)));
  const nodePositions = ref<NodePosition[]>([]);
  const chainMemberZoneIds = computed(() => new Set(nodePositions.value.filter(n => n.chainId).map(n => n.zoneId)));

  // Friendly ID for a chain: now persisted on the server as `chainNumber`. The
  // map below stays for legacy callers and as a fallback if a chain row hasn't
  // been migrated yet (it'll synthesize an ID by insertion order).
  const chainFriendlyIdMap = computed(() => {
    const map = new Map<string, number>();
    const primary = chains.value.find(c => c.sourceZoneId === homeZoneId.value);
    if (primary) map.set(primary.id, primary.chainNumber ?? 1);
    let next = 2;
    for (const c of chains.value) {
      if (map.has(c.id)) continue;
      map.set(c.id, c.chainNumber ?? next++);
    }
    return map;
  });
  function chainFriendlyId(chainId: string | undefined | null): number | null {
    if (!chainId) return null;
    const direct = chains.value.find(c => c.id === chainId)?.chainNumber;
    if (typeof direct === 'number') return direct;
    return chainFriendlyIdMap.value.get(chainId) ?? null;
  }
  function chainColorForZone(zoneId: string | undefined | null): string | null {
    if (!zoneId) return null;
    const np = nodePositions.value.find(n => n.zoneId === zoneId);
    if (np?.chainId) {
      const c = chains.value.find(ch => ch.id === np.chainId);
      if (c?.chainColor) return c.chainColor;
    }
    // Fallback to primary chain colour (or the palette default) so the pill
    // still has a sensible colour while data is loading or for unchained nodes.
    const primary = chains.value.find(c => c.sourceZoneId === homeZoneId.value);
    return primary?.chainColor ?? PRIMARY_CHAIN_COLOR;
  }
  function chainForZone(zoneId: string | undefined | null): RoomChain | null {
    if (!zoneId) return null;
    const np = nodePositions.value.find(n => n.zoneId === zoneId);
    if (np?.chainId) {
      const c = chains.value.find(ch => ch.id === np.chainId);
      if (c) return c;
    }
    // Fallback: primary chain
    return chains.value.find(c => c.sourceZoneId === homeZoneId.value) ?? null;
  }
  function chainTooltipForZone(zoneId: string | undefined | null): string | null {
    const c = chainForZone(zoneId);
    if (!c) return null;
    const fid = chainFriendlyId(c.id);
    const sourceName = ZONE_BY_ID.get(c.sourceZoneId)?.name ?? c.sourceZoneId;
    return `Chain #${fid ?? '?'} starting at ${sourceName}`;
  }
  function chainFriendlyIdForZone(zoneId: string | undefined | null): number | null {
    if (!zoneId) return null;
    const np = nodePositions.value.find(n => n.zoneId === zoneId);
    const id = chainFriendlyId(np?.chainId);
    if (id !== null) return id;
    // Fallback: if the zone exists in this room but has no chainId metadata
    // (older data, or non-roads node not yet tagged), assume it belongs to
    // the primary chain so the pill is still shown.
    if (np) {
      const primary = chains.value.find(c => c.sourceZoneId === homeZoneId.value);
      if (primary) return chainFriendlyIdMap.value.get(primary.id) ?? 1;
      return 1;
    }
    return null;
  }
  const roomTitle = ref<string>('');
  const wsStatus = ref<WsStatus>('disconnected');
  const lastUpdate = ref<Date | null>(null);
  const lastPing = ref<{zoneName: string, nodeId?: string} | null>(null);
  const watchingCount = ref<number | null>(null);
  const totalConnected = ref<number | null>(null);
  const roomId = ref<string>('');
  const isConnecting = ref(false);
  const disconnectReason = ref<DisconnectReason>(null);
  const connectingSourceHandleId = ref<string | null>(null);
  const connectingSourceNodeId = ref<string | null>(null);
  const chainManagementOpen = ref(false);
  function openChainManagement() { chainManagementOpen.value = true; }

  // "Ghost-on-cursor" placement state for new chains. While non-null, RoomView
  // renders a ghost that follows the cursor; the next left-click on the canvas
  // creates the chain at that flow coordinate. ESC / right-click cancels.
  const pendingChainSourceZoneId = ref<string | null>(null);
  function beginPlacingChain(sourceZoneId: string) {
    pendingChainSourceZoneId.value = sourceZoneId;
  }
  function cancelPlacingChain() {
    pendingChainSourceZoneId.value = null;
  }

  let ws: WebSocket | null = null;
  let reconnectDelay = 1000;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  function isNodeIsolated(nodeId: string, currentTime: number) {
    if (nodeId === homeZoneId.value || chainSourceZoneIds.value.has(nodeId)) return false;
    const nodeConnections = connections.value.filter(c => c.fromZoneId === nodeId || c.toZoneId === nodeId);
    if (nodeConnections.length === 0) return true;
    return nodeConnections.every(c => (c.isExpired ?? false) || (new Date(c.expiresAt).getTime() - currentTime) <= 0);
  }

  function isNodeExpired(nodeId: string, currentTime: number) {
    if (nodeId === homeZoneId.value || chainSourceZoneIds.value.has(nodeId)) return false;

    const nodeConnections = connections.value.filter(c => c.fromZoneId === nodeId || c.toZoneId === nodeId);

    // A node is expired if it has NO valid path to the hideout.
    // A path is valid if the connection itself is NOT expired AND the connection is NOT isolated (i.e., its ancestors are valid).
    const hasValidPathToHideout = nodeConnections.some(c =>
        !isEdgeIsolated(c.id, currentTime) &&
        !((c.isExpired ?? false) || (new Date(c.expiresAt).getTime() - currentTime) <= 0)
    );

    return !hasValidPathToHideout;
  }

  function isNodeRestricted(nodeId: string, currentTime: number) {
    return isNodeIsolated(nodeId, currentTime) || isNodeExpired(nodeId, currentTime);
  }

  function isEdgeIsolated(connectionId: string, currentTime: number) {
    const conn = connections.value.find(c => c.id === connectionId);
    if (!conn) return false;
    const ancestors = treeQuery(conn.id, connections.value, 'ancestors');
    return ancestors.some(a => (a.isExpired ?? false) || (new Date(a.expiresAt).getTime() - currentTime) <= 0);
  }

  /** Always reads the live token from localStorage — never cached, so any deletion is immediately visible. */
  function getToken(): string {
    return roomId.value ? (localStorage.getItem(`token:${roomId.value}`) ?? '') : '';
  }

  function setCredentials(id: string, jwt: string) {
    roomId.value = id;
    localStorage.setItem(`token:${id}`, jwt);
  }

  function send(msg: any) {
    if (!getToken()) {
      console.warn('[RoomStore] send() BLOCKED — token missing from localStorage, triggering session_expired flow');
      applyMessage({ type: 'session_expired', reason: 'Session expired, please log in again' });
      return;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    } else {
      console.warn('[RoomStore] send() DROPPED — ws not open', msg.type, 'readyState:', ws?.readyState);
    }
  }

  const rotationErrors = ref<string[]>([]);

  function validateNodeRotations(positions: NodePosition[]) {
    const errors: string[] = [];
    for (const node of positions) {
      const zone = ZONE_BY_ID.get(node.zoneId);
      if (!zone || zone.type === 'roadsHideout') continue;
      const shape = zone.mapShape;
      if (!shape) continue;
      const defaultHandles = getShapeHandlePositions(shape);
      if (defaultHandles.length === 0) continue;
      const customHandles = node.customHandles;
      const stored0 = node.rotation ?? 0;
      if (!customHandles || customHandles.length === 0) {
        // No saved handles means the zone is at default layout — which is only
        // valid when stored rotation is 0. A non-zero stored rotation with no
        // handles is a desync (e.g. a partial reset that wiped the handles but
        // not the rotation, or vice versa) and must be flagged so the user can
        // reset the zone via the hourglass button.
        if (stored0 !== 0) {
          console.warn(
            `[RotationValidation] Zone "${node.zoneId}" has stored rotation=${stored0} ` +
            `but no custom handles — layout is inconsistent.`
          );
          errors.push(node.zoneId);
        }
        continue;
      }

      // Only consider the shape's own handle ids when inferring rotation —
      // user-added customs aren't part of the shape and can sit anywhere on
      // the perimeter. Previously these were included, which masked desyncs.
      const shapeHandleRegex = new RegExp(`^${shape}-p\\d+$`);
      const shapeHandles = customHandles.filter(h => shapeHandleRegex.test(h.id));
      const stored = node.rotation ?? 0;

      // If the shape's handles aren't all present (e.g. corruption from a
      // partially-applied update), that's a desync we should flag and let the
      // server self-heal on next interaction.
      if (shapeHandles.length !== defaultHandles.length) {
        console.warn(
          `[RotationValidation] Zone "${node.zoneId}" has ${shapeHandles.length}/${defaultHandles.length} shape handles; ` +
          `data is inconsistent with shape "${shape}".`
        );
        errors.push(node.zoneId);
        continue;
      }

      const inferred = inferRotationFromHandles(shapeHandles, defaultHandles);
      if (inferred === null) {
        // Handles can't be matched to any rotation — definite desync.
        console.warn(
          `[RotationValidation] Zone "${node.zoneId}" handles do not match any rotation of shape "${shape}".`
        );
        errors.push(node.zoneId);
        continue;
      }

      if (inferred !== stored) {
        console.warn(
          `[RotationValidation] Mismatch on zone "${node.zoneId}": ` +
          `stored rotation=${stored} but handles imply rotation=${inferred}. ` +
          `The stored rotation value may be stale due to a sync race condition.`
        );
        errors.push(node.zoneId);
      }
    }
    rotationErrors.value = errors;
  }

  function clearRotationError(zoneId: string) {
    rotationErrors.value = rotationErrors.value.filter(id => id !== zoneId);
  }

  function applyMessage(msg: ServerMessage) {
    const memoryStore = useRoomMemoryStore();
    switch (msg.type) {
      case 'sync':
        connections.value = msg.connections;
        homeZoneId.value = msg.homeZoneId;
        chains.value = msg.chains ?? [];
        roomTitle.value = msg.title || '';
        nodePositions.value = msg.nodePositions;
        validateNodeRotations(msg.nodePositions);
        lastUpdate.value = new Date(msg.lastUpdatedAt);
        watchingCount.value = msg.watching;
        totalConnected.value = msg.totalConnected;
        addToRecentRooms(roomId.value, roomId.value, roomTitle.value);
        if (msg.plottedRoute && msg.plottedRoute.length > 0) {
          const plotRouteStore = usePlotRouteStore();
          plotRouteStore.applyPlottedRoute(msg.plottedRoute, msg.plottedRouteFromZoneId, msg.plottedRouteToZoneId, msg.plottedRouteChainId);
        }
        break;

      case 'memory_sync':
        memoryStore.applyMemorySync(msg.memory);
        break;

      case 'memory_updated':
        memoryStore.applyMemoryUpdated(msg.entry);
        break;

      case 'memory_deleted':
        memoryStore.applyMemoryDeleted(msg.zoneId);
        break;

      case 'connection_added':
        if (!connections.value.find((c) => c.id === msg.connection.id)) {
          connections.value = [...connections.value, msg.connection];
        }
        lastUpdate.value = new Date(msg.connection.reportedAt);
        // Mark the destination zone as explored when a non-center handle is used
        if (msg.connection.toHandleId && msg.connection.toHandleId !== 'center') {
          markNodeExplored(msg.connection.toZoneId);
        }
        if (msg.connection.fromHandleId && msg.connection.fromHandleId !== 'center') {
          markNodeExplored(msg.connection.fromZoneId);
        }
        break;

      case 'connection_updated':
        {
          const index = connections.value.findIndex((c) => c.id === msg.connection.id);
          const oldConn = index !== -1 ? connections.value[index] : null;
          if (index !== -1) {
            const newConnections = [...connections.value];
            newConnections[index] = msg.connection;
            connections.value = newConnections;
          }
          // Mark zones as explored only when a handle changes from center/unset to a non-center handle.
          // Editing time or portal size alone must not flag the destination zone as explored.
          const oldToHandle = oldConn?.toHandleId ?? null;
          const newToHandle = msg.connection.toHandleId ?? null;
          const toHandleChanged = (!oldToHandle || oldToHandle === 'center') && newToHandle && newToHandle !== 'center';
          if (toHandleChanged) {
            markNodeExplored(msg.connection.toZoneId);
          }
          const oldFromHandle = oldConn?.fromHandleId ?? null;
          const newFromHandle = msg.connection.fromHandleId ?? null;
          const fromHandleChanged = (!oldFromHandle || oldFromHandle === 'center') && newFromHandle && newFromHandle !== 'center';
          if (fromHandleChanged) {
            markNodeExplored(msg.connection.fromZoneId);
          }
        }
        lastUpdate.value = new Date();
        break;

      case 'connection_removed':
        if (msg.connectionId) {
          connections.value = connections.value.filter((c) => c.id !== msg.connectionId);
          usePlotRouteStore().onConnectionRemoved(msg.connectionId);
        }
        // The server batches any zones that became orphaned (no remaining
        // connections, not a chain source / home zone) into the same message
        // via `removedZoneIds`, so we remove them in one step here.
        if (msg.removedZoneIds && msg.removedZoneIds.length > 0) {
          const removedZones = new Set(msg.removedZoneIds);
          nodePositions.value = nodePositions.value.filter(p => !removedZones.has(p.zoneId));
          try {
            const memoryStore = useRoomMemoryStore();
            for (const zoneId of removedZones) memoryStore.applyMemoryDeleted(zoneId);
          } catch { /* memory store optional */ }
        }
        lastUpdate.value = new Date();
        break;

      case 'connection_expired':
        {
          const index = connections.value.findIndex((c) => c.id === msg.connectionId);
          if (index !== -1) {
            const newConnections = [...connections.value];
            newConnections[index] = { ...newConnections[index], isExpired: true };
            connections.value = newConnections;
          }
        }
        lastUpdate.value = new Date();
        break;

      case 'room_updated':
        homeZoneId.value = msg.homeZoneId;
        lastUpdate.value = new Date();
        break;

      case 'room_title_updated':
        roomTitle.value = msg.title;
        addToRecentRooms(roomId.value, roomId.value, msg.title);
        break;
      
      case 'room_reset':
        connections.value = [];
        nodePositions.value = nodePositions.value.filter(n => n.zoneId === homeZoneId.value);
        lastUpdate.value = new Date();
        usePlotRouteStore().exitPlotRouteMode();
        break;

      case 'password_rotated':
        // The room password was changed — invalidate the stored token and force re-authentication
        localStorage.removeItem(`token:${roomId.value}`);
        disconnectReason.value = 'password_rotated';
        wsStatus.value = 'auth_failed';
        ws?.close();
        ws = null;
        break;

      case 'room_deleted':
        // The room has been permanently deleted — boot all users out
        localStorage.removeItem(`token:${roomId.value}`);
        disconnectReason.value = 'room_deleted';
        wsStatus.value = 'auth_failed';
        ws?.close();
        ws = null;
        break;

      case 'force_reload':
        // Server completed a one-shot data migration — reload the page to pick it up cleanly
        window.location.reload();
        break;

      case 'chain_added':
        if (!chains.value.find(c => c.id === msg.chain.id)) {
          chains.value = [...chains.value, msg.chain];
        } else {
          // The eager-add in addChain() may have inserted a stub already; merge
          // in any server-authoritative fields (e.g. final chainNumber/color).
          chains.value = chains.value.map(c => c.id === msg.chain.id ? { ...c, ...msg.chain } : c);
        }
        lastUpdate.value = new Date();
        break;

      case 'chain_updated':
        chains.value = chains.value.map(c => c.id === msg.chain.id ? { ...c, ...msg.chain } : c);
        lastUpdate.value = new Date();
        break;

      case 'chain_relocated': {
        chains.value = chains.value.map(c => c.id === msg.chain.id ? { ...c, ...msg.chain } : c);
        const removedZones = new Set(msg.removedZoneIds);
        const removedConns = new Set(msg.removedConnectionIds);
        if (removedConns.size > 0) {
          connections.value = connections.value.filter(c => !removedConns.has(c.id));
        }
        // Drop every wiped node, then add the freshly-created source node row.
        nodePositions.value = nodePositions.value.filter(p => !removedZones.has(p.zoneId));
        nodePositions.value = [...nodePositions.value, msg.newSourceNodePosition];
        try {
          const memoryStore = useRoomMemoryStore();
          for (const zoneId of removedZones) {
            memoryStore.applyMemoryDeleted(zoneId);
          }
        } catch { /* memory store optional */ }
        if (msg.newHomeZoneId) {
          homeZoneId.value = msg.newHomeZoneId;
        }
        lastUpdate.value = new Date();
        break;
      }

      case 'chain_removed': {
        chains.value = chains.value.filter(c => c.id !== msg.chainId);
        const removedZones = new Set(msg.removedZoneIds);
        const removedConns = new Set(msg.removedConnectionIds);
        if (removedConns.size > 0) {
          connections.value = connections.value.filter(c => !removedConns.has(c.id));
        }
        if (removedZones.size > 0) {
          nodePositions.value = nodePositions.value.filter(p => !removedZones.has(p.zoneId));
          try {
            const memoryStore = useRoomMemoryStore();
            for (const zoneId of removedZones) {
              memoryStore.applyMemoryDeleted(zoneId);
            }
          } catch { /* memory store optional */ }
        }
        lastUpdate.value = new Date();
        break;
      }

      case 'session_expired':
        // The JWT has expired or is invalid — clear the token and redirect to auth
        localStorage.removeItem(`token:${roomId.value}`);
        disconnectReason.value = 'session_expired';
        wsStatus.value = 'auth_failed';
        ws?.close();
        ws = null;
        break;

      case 'error':
        // Handle fatal server errors — treat "Room not found" as a hard redirect
        if (msg.message === 'Room not found') {
          localStorage.removeItem(`token:${roomId.value}`);
          disconnectReason.value = 'room_not_found';
          wsStatus.value = 'auth_failed';
          ws?.close();
          ws = null;
        }
        break;

      case 'plot_route_updated':
        usePlotRouteStore().applyPlottedRoute(msg.plottedRoute, msg.fromZoneId, msg.toZoneId, msg.chainId);
        break;
      
      case 'node_positions_updated':
        {
          // Upsert: update entries present in the broadcast and keep all other
          // preexisting node positions untouched. This avoids clobbering nodes
          // belonging to existing chains when a single-row broadcast (e.g. a
          // newly added chain's source zone) arrives.
          const incomingById = new Map(msg.nodePositions.map((p: NodePosition) => [p.zoneId, p]));
          const next = nodePositions.value.map((existing) => {
            const p = incomingById.get(existing.zoneId);
            if (!p) return existing;
            incomingById.delete(existing.zoneId);
            return {
              ...existing,
              x: p.x,
              y: p.y,
              virtualGridPos: p.virtualGridPos ?? existing.virtualGridPos,
              proximityTo: p.proximityTo ?? existing.proximityTo,
              features: p.features ?? existing.features,
              customHandles: p.customHandles ?? existing.customHandles,
              rotation: p.rotation ?? existing.rotation,
              explored: p.explored || existing.explored,
              chainId: p.chainId ?? existing.chainId,
            };
          });
          // Append any new entries the broadcast added.
          for (const p of incomingById.values()) next.push(p);
          nodePositions.value = next;
          // Re-validate after applying authoritative server data so the UI
          // reflects the corrected/uncorrected state of any changed zones.
          validateNodeRotations(nodePositions.value);
        }
        if (msg.updateLastUpdated) {
          lastUpdate.value = new Date();
        }
        break;
      
      case 'ping':
        lastPing.value = null;
        nextTick(() => {
          lastPing.value = { zoneName: msg.zoneName, nodeId: msg.nodeId };
        });
        break;

      case 'marco':
        send({ type: 'polo' });
        break;

      case 'watching':
        watchingCount.value = msg.count;
        totalConnected.value = msg.totalConnected;
        break;
    }
  }

  function connect() {
    if (!roomId.value) return;
    if (!getToken()) {
      applyMessage({ type: 'session_expired', reason: 'Session expired, please log in again' });
      return;
    }
    if (ws && ws.readyState === WebSocket.OPEN) return;

    wsStatus.value = 'connecting';
    const url = new URL(`${API_BASE_URL}/ws/rooms/${roomId.value}`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(url.toString());

    ws.addEventListener('open', () => {
      const currentToken = getToken();
      if (!currentToken) {
        ws?.close();
        applyMessage({ type: 'session_expired', reason: 'Session expired, please log in again' });
        return;
      }
      ws!.send(JSON.stringify({ type: 'auth', token: currentToken }));
    });

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerMessage;
        if (msg.type === 'auth_ok') {
          wsStatus.value = 'connected';
          lastUpdate.value = new Date();
          reconnectDelay = 1000;
        } else {
          applyMessage(msg);
        }
      } catch {
        // ignore bad JSON
      }
    });

    ws.addEventListener('close', (event) => {
      if (event.code === 4401) {
        wsStatus.value = 'auth_failed';
        return;
      }
      wsStatus.value = 'disconnected';
      scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      ws?.close();
    });
  }

  function scheduleReconnect() {
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
      connect();
    }, reconnectDelay);
  }

  function disconnect() {
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    ws?.close();
    ws = null;
    wsStatus.value = 'disconnected';
    connections.value = [];
    homeZoneId.value = '';
    chains.value = [];
    roomTitle.value = '';
    nodePositions.value = [];
    roomId.value = '';
    watchingCount.value = null;
    totalConnected.value = null;
    useRoomMemoryStore().clear();
  }

  function exitRoom() {
    disconnect();
    track('exit_room');
  }

  function updateNodePositionsInStore(positions: NodePosition[]) {
    if (!positions) return;
    // Merge incoming positions with existing ones, preserving explored/features/customHandles
    // for nodes that already exist unless the incoming data explicitly provides them.
    // IMPORTANT: the server's `update_node_positions` handler performs a full
    // DELETE + reinsert of `room_node_positions` for the room, so the payload
    // MUST contain every node we want to keep. Sending only the changed nodes
    // would wipe every other zone in the room (and re-broadcast the truncated
    // set to all clients, shuffling/dropping pre-existing chain nodes). So we
    // build a full snapshot here: start from the current `nodePositions` and
    // overlay the incoming changes.
    const incomingById = new Map(positions.map(p => [p.zoneId, p]));
    const merged: NodePosition[] = nodePositions.value.map(existing => {
      const p = incomingById.get(existing.zoneId);
      if (!p) return existing;
      incomingById.delete(existing.zoneId);
      return {
        ...existing,
        x: p.x,
        y: p.y,
        virtualGridPos: p.virtualGridPos ?? existing.virtualGridPos,
        proximityTo: p.proximityTo ?? existing.proximityTo,
        features: p.features ?? existing.features,
        customHandles: p.customHandles ?? existing.customHandles,
        explored: p.explored || existing.explored,
        // Preserve chainId so a position-only update (e.g. dragging a freshly
        // created chain source) doesn't strip the chain membership locally.
        chainId: p.chainId ?? existing.chainId,
      };
    });
    // Append any incoming entries that aren't yet in the store.
    for (const p of incomingById.values()) merged.push(p);
    send({ type: 'update_node_positions', nodePositions: merged });
    nodePositions.value = merged; // Optimistic update
    track('move_node');
  }

  function resetNodePositions() {
    nodePositions.value = []; // Optimistic update
    lastUpdate.value = new Date();
    send({ type: 'update_node_positions', nodePositions: [], updateLastUpdated: true });
    track('reset_node_positions');
  }

  function markNodeExplored(zoneId: string) {
    const index = nodePositions.value.findIndex(n => n.zoneId === zoneId);
    if (index === -1) return;
    if (nodePositions.value[index].explored) return;
    const newNodePositions = [...nodePositions.value];
    newNodePositions[index] = { ...newNodePositions[index], explored: true };
    nodePositions.value = newNodePositions;
    lastUpdate.value = new Date();
    send({ type: 'update_node_positions', nodePositions: nodePositions.value, updateLastUpdated: true });
  }

  function updateNodeFeatures(zoneId: string, features: NodeFeatures, markExplored = true) {
    const index = nodePositions.value.findIndex(n => n.zoneId === zoneId);
    if (index === -1) return;
    const newNodePositions = [...nodePositions.value];
    const featuresWithTimestamp = { ...features, lastUpdatedAt: Date.now() };
    const currentExplored = newNodePositions[index].explored ?? false;
    newNodePositions[index] = { ...newNodePositions[index], features: featuresWithTimestamp, explored: markExplored ? true : currentExplored };
    nodePositions.value = newNodePositions;
    lastUpdate.value = new Date();
    send({ type: 'update_node_positions', nodePositions: nodePositions.value, updateLastUpdated: true });
    track('update_node_features');
  }

  function updateNodeCustomHandles(zoneId: string, customHandles: CustomHandle[]) {
    const index = nodePositions.value.findIndex(n => n.zoneId === zoneId);
    if (index === -1) return;
    const newNodePositions = [...nodePositions.value];
    const existingFeatures = newNodePositions[index].features || {};
    const featuresWithTimestamp = { ...existingFeatures, lastUpdatedAt: Date.now() };
    newNodePositions[index] = { ...newNodePositions[index], customHandles, features: featuresWithTimestamp, explored: true };
    nodePositions.value = newNodePositions;
    lastUpdate.value = new Date();
    send({ type: 'update_node_positions', nodePositions: nodePositions.value, updateLastUpdated: true });
    track('update_node_handles');
  }

  function resetZonePortals(zoneId: string) {
    const index = nodePositions.value.findIndex(n => n.zoneId === zoneId);
    if (index === -1) return;
    const newNodePositions = [...nodePositions.value];
    newNodePositions[index] = { ...newNodePositions[index], rotation: 0, customHandles: [] };
    nodePositions.value = newNodePositions;
    lastUpdate.value = new Date();
    // Use the dedicated rotate endpoint: this guarantees server-side validation
    // and an authoritative broadcast, which clears any stale rotation/handle
    // desync without depending on the generic position update path.
    send({ type: 'rotate_zone', zoneId, rotation: 0 });
    clearRotationError(zoneId);
    track('reset_zone_portals');
  }

  function updateNodeRotation(zoneId: string, rotation: number) {
    const index = nodePositions.value.findIndex(n => n.zoneId === zoneId);
    if (index === -1) return;
    const newNodePositions = [...nodePositions.value];
    newNodePositions[index] = { ...newNodePositions[index], rotation, explored: true };
    nodePositions.value = newNodePositions;
    lastUpdate.value = new Date();
    // Dedicated rotate endpoint — the server is the single source of truth for
    // rotation/handle consistency and will re-broadcast the canonical state
    // to all clients (including this one).
    send({ type: 'rotate_zone', zoneId, rotation });
    clearRotationError(zoneId);
    track('update_node_rotation');
  }

  // Recently Viewed Rooms
  interface RecentRoom {
    id: string;
    vanityUrl: string;
    title: string;
  }

  const shapeBackgroundOpacity = ref<number>(Number(localStorage.getItem('shapeBackgroundOpacity') || 30));

  function setShapeBackgroundOpacity(opacity: number) {
    shapeBackgroundOpacity.value = opacity;
    localStorage.setItem('shapeBackgroundOpacity', String(opacity));
  }

  const animationsEnabled = ref<boolean>(localStorage.getItem('animationsEnabled') !== 'false');

  function setAnimationsEnabled(enabled: boolean) {
    animationsEnabled.value = enabled;
    localStorage.setItem('animationsEnabled', String(enabled));
  }

  const bluePromptsEnabled = ref<boolean>(localStorage.getItem('bluePromptsEnabled') !== 'false');

  function setBluePromptsEnabled(enabled: boolean) {
    bluePromptsEnabled.value = enabled;
    localStorage.setItem('bluePromptsEnabled', String(enabled));
  }

  const recentlyViewedRooms = ref<RecentRoom[]>(JSON.parse(localStorage.getItem('recentRooms') || '[]').map((r: any) => ({
    id: r.id,
    vanityUrl: r.vanityUrl || r.id,
    title: r.title,
  })));

  function addToRecentRooms(id: string, vanityUrl: string, title: string) {
    if (!id) return;
    const existing = recentlyViewedRooms.value.findIndex(r => r.id === id);
    if (existing !== -1) {
      recentlyViewedRooms.value.splice(existing, 1);
    }
    recentlyViewedRooms.value.unshift({ id, vanityUrl, title: title || id });
    recentlyViewedRooms.value = recentlyViewedRooms.value.slice(0, 10); // Keep last 10
    localStorage.setItem('recentRooms', JSON.stringify(recentlyViewedRooms.value));
  }

  function removeFromRecentRooms(id: string) {
    recentlyViewedRooms.value = recentlyViewedRooms.value.filter(r => r.id !== id);
    localStorage.setItem('recentRooms', JSON.stringify(recentlyViewedRooms.value));
  }

  async function importData(data: { 
    connections: any[], 
    nodePositions: NodePosition[], 
    homeZoneId: string,
    roomHistory?: RoomMemoryEntry[]
  }) {
    if (!roomId.value || !getToken()) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${API_BASE_URL}/api/rooms/${roomId.value}/import`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to import data: ${await response.text()}`);
    }
    
    // Update memory if provided
    if (data.roomHistory) {
      const memoryStore = useRoomMemoryStore();
      memoryStore.applyMemorySync(data.roomHistory);
    }
  }

  async function addChain(sourceZoneId: string, position?: { x: number; y: number }) {
    if (!roomId.value || !getToken()) {
      throw new Error('Not authenticated');
    }

    const body: { sourceZoneId: string; x?: number; y?: number } = { sourceZoneId };
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
      body.x = position.x;
      body.y = position.y;
    }

    const response = await fetch(`${API_BASE_URL}/api/rooms/${roomId.value}/chains`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      let message = text;
      try { message = JSON.parse(text).error ?? text; } catch { /* not JSON */ }
      throw new Error(message || `Failed to add chain (HTTP ${response.status})`);
    }

    // Eagerly merge the new chain into our local state from the HTTP response
    // so the friendly ID / colour reflect immediately, without waiting for the
    // chain_added broadcast (which can race with UI rendering).
    try {
      const body = await response.clone().json() as { chain?: RoomChain };
      if (body?.chain && !chains.value.find(c => c.id === body.chain!.id)) {
        chains.value = [...chains.value, body.chain];
      }
    } catch { /* ignore JSON parse issues; broadcast will catch up */ }

    // NOTE: previously we placed the new chain's source zone at a random
    // offset 200px from the primary home, but that triggered an
    // `update_node_positions` round-trip which (server-side: DELETE+reinsert)
    // was clobbering preexisting nodes. Per user request, all repositioning
    // logic on chain creation has been removed — the server's initial (0,0)
    // placement stands, and existing nodes are left completely untouched.
  }

  async function updateChainColor(chainId: string, chainColor: string) {
    if (!roomId.value || !getToken()) {
      throw new Error('Not authenticated');
    }
    const response = await fetch(`${API_BASE_URL}/api/rooms/${roomId.value}/chains/${chainId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`,
      },
      body: JSON.stringify({ chainColor }),
    });
    if (!response.ok) {
      const text = await response.text();
      let message = text;
      try { message = JSON.parse(text).error ?? text; } catch { /* not JSON */ }
      throw new Error(message || `Failed to update chain colour (HTTP ${response.status})`);
    }
    // Eagerly merge the new colour so the pill updates immediately.
    try {
      const body = await response.clone().json() as { chain?: RoomChain };
      if (body?.chain) {
        chains.value = chains.value.map(c => c.id === body.chain!.id ? { ...c, ...body.chain } : c);
      }
    } catch { /* broadcast will catch up */ }
  }

  async function relocateChain(chainId: string, newSourceZoneId: string) {
    if (!roomId.value || !getToken()) {
      throw new Error('Not authenticated');
    }
    const response = await fetch(`${API_BASE_URL}/api/rooms/${roomId.value}/chains/${chainId}/relocate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`,
      },
      body: JSON.stringify({ sourceZoneId: newSourceZoneId }),
    });
    if (!response.ok) {
      const text = await response.text();
      let message = text;
      try { message = JSON.parse(text).error ?? text; } catch { /* not JSON */ }
      throw new Error(message || `Failed to relocate chain (HTTP ${response.status})`);
    }
  }

  async function removeChain(chainId: string) {
    if (!roomId.value || !getToken()) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${API_BASE_URL}/api/rooms/${roomId.value}/chains/${chainId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${getToken()}`
      },
    });

    if (!response.ok) {
      const text = await response.text();
      let message = text;
      try { message = JSON.parse(text).error ?? text; } catch { /* not JSON */ }
      throw new Error(message || `Failed to remove chain (HTTP ${response.status})`);
    }
  }

  return {
    connections,
    homeZoneId,
    roomTitle,
    nodePositions,
    wsStatus,
    lastUpdate,
    lastPing,
    watchingCount,
    rotationErrors,
    clearRotationError,
    totalConnected,
    token: computed(getToken),
    roomId,
    isConnecting,
    disconnectReason,
    connectingSourceHandleId,
    connectingSourceNodeId,
    recentlyViewedRooms,
    chains,
    chainSourceZoneIds,
    chainMemberZoneIds,
    chainFriendlyId,
    chainFriendlyIdForZone,
    chainColorForZone,
    chainForZone,
    chainTooltipForZone,
    chainManagementOpen,
    openChainManagement,
    pendingChainSourceZoneId,
    beginPlacingChain,
    cancelPlacingChain,
    setCredentials,
    applyMessage,
    updateNodePositionsInStore,
    markNodeExplored,
    updateNodeFeatures,
    updateNodeCustomHandles,
    updateNodeRotation,
    isNodeIsolated,
    isNodeExpired,
    isNodeRestricted,
    isEdgeIsolated,
    resetNodePositions,
    resetZonePortals,
    send,
    connect,
    disconnect,
    exitRoom,
    shapeBackgroundOpacity,
    setShapeBackgroundOpacity,
    animationsEnabled,
    setAnimationsEnabled,
    bluePromptsEnabled,
    setBluePromptsEnabled,
    removeFromRecentRooms,
    importData,
    addChain,
    removeChain,
    updateChainColor,
    relocateChain,
  };
});
