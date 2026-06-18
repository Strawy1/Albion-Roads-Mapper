<script setup lang="ts">
import { Position, useVueFlow, Handle } from '@vue-flow/core';
import type { CustomHandle } from 'shared';
import { getHandleFacing } from 'shared';
import { connectionStyle } from '@/utils/connectionStyle';
import { useRoomStore } from '@/stores/useRoomStore';
import { usePlotRouteStore } from '@/stores/usePlotRouteStore';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import { Z_INDEX } from '@/constants/Layers';

const props = defineProps<{
  nodeId: string;
  nodeType: string;
  handles: CustomHandle[];
  isRestricted: boolean;
  now: number;
}>();

const store = useRoomStore();
const plotRouteStore = usePlotRouteStore();
const { connections, isConnecting, nodePositions, connectingSourceNodeId } = storeToRefs(store);
const { findNode } = useVueFlow();

// ── Chain / visibility computeds ────────────────────────────────────────────

const sourceChainId = computed(() => {
  if (!connectingSourceNodeId.value) return null;
  return nodePositions.value.find(n => n.zoneId === connectingSourceNodeId.value)?.chainId ?? null;
});

const thisChainId = computed(() =>
  nodePositions.value.find(n => n.zoneId === props.nodeId)?.chainId ?? null
);

const isOutsideSourceChain = computed(() =>
  isConnecting.value &&
  sourceChainId.value !== null &&
  props.nodeId !== connectingSourceNodeId.value &&
  thisChainId.value !== sourceChainId.value
);

const connectedHandleIds = computed(() => {
  const ids = new Set<string>();
  for (const c of connections.value) {
    if (c.fromZoneId === props.nodeId && c.fromHandleId) ids.add(c.fromHandleId);
    if (c.toZoneId === props.nodeId && c.toHandleId) ids.add(c.toHandleId);
  }
  return ids;
});

const isSourceRoadsZone = computed(() => {
  if (!connectingSourceNodeId.value) return false;
  const sourceNode = findNode(connectingSourceNodeId.value);
  return sourceNode?.data?.type === 'roads';
});

/**
 * Whether a handle should be rendered at all.
 * Rules:
 *  - center-overlay is always shown (needed for connection targeting on outside-chain nodes)
 *  - otherwise: show if same chain, or if the handle already has a connection
 */
const isHandleVisible = (handleId: string): boolean => {
  if (handleId === 'center-overlay') return true;
  if (!isOutsideSourceChain.value) return true;
  return connectedHandleIds.value.has(handleId);
};

/**
 * Opacity for a handle when this node is outside the source chain.
 */
const handleOpacity = (handleId: string): number | undefined => {
  if (!isOutsideSourceChain.value) return undefined;
  // center-overlay and connected handles are dimmed, not hidden
  return 0.25;
};

/**
 * Whether the center-overlay should use the small snap area.
 * Applied when dragging from a roads zone onto a non-roads node.
 */
const usesSmallCenterSnap = computed(() =>
  isSourceRoadsZone.value && props.nodeType !== 'roads'
);

// ── Handle state computeds ───────────────────────────────────────────────────

const hoveredHandleId = ref<string | null>(null);

const isPulsing = (handleId: string): boolean => {
  return (
    isConnecting.value &&
    (
      (handleId === store.connectingSourceHandleId && props.nodeId === store.connectingSourceNodeId) ||
      handleId === hoveredHandleId.value
    ) &&
    handleId !== 'center-overlay'
  );
};

const isIdle = (handleId: string): boolean => {
  if (handleId === 'center-overlay') return false;
  if (isPulsing(handleId)) return false;
  if (isConnecting.value) return true;
  return handleId !== 'center';
};

const isActive = (handleId: string): boolean => {
  if (handleId === 'center-overlay') return false;
  return isConnecting.value && !isPulsing(handleId);
};

const handleEdgeClass = (handleId: string): string => {
  if (handleId === 'center' || handleId === 'center-overlay') return '';
  const conn = connections.value.find(c =>
    (c.fromZoneId === props.nodeId && c.fromHandleId === handleId) ||
    (c.toZoneId === props.nodeId && c.toHandleId === handleId)
  );
  if (!conn) return '';
  if (plotRouteStore.plottedConnectionIds.has(conn.id))
    return store.animationsEnabled ? 'handle-edge-plotted' : 'handle-edge-blue';
  if (props.isRestricted || store.isEdgeIsolated(conn.id, props.now)) return 'handle-edge-grey';
  const remainingMs = new Date(conn.expiresAt).getTime() - props.now;
  const style = connectionStyle(remainingMs, conn.isExpired ?? false);
  if (style.stroke === '#0ee25e') return 'handle-edge-green';
  if (style.stroke === '#f59e0b') return 'handle-edge-orange';
  if (style.stroke === '#ef4444') return 'handle-edge-red';
  return 'handle-edge-grey';
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function getHandlePosition(left: string, top: string): Position {
  const facing = getHandleFacing(left, top);
  if (facing === 'n') return Position.Top;
  if (facing === 's') return Position.Bottom;
  if (facing === 'w') return Position.Left;
  return Position.Right;
}

function centerOverlayClasses(): string[] {
  return [
    'center-handle-snap',
    ...(usesSmallCenterSnap.value ? ['center-handle-snap-small'] : []),
  ];
}
</script>

<template>
  <template v-for="handle in handles" :key="handle.id">
    <!-- Disabled (non-interactive) handle placeholder -->
    <div
      v-if="handle.disabled && isHandleVisible(handle.id)"
      class="handle absolute"
      :class="[
        Z_INDEX.HANDLE,
        `facing-${getHandleFacing(handle.left, handle.top)}`,
        'is-disabled'
      ]"
      :style="{ left: handle.left, top: handle.top, opacity: handleOpacity(handle.id) }"
    />

    <!-- Active (interactive) handle -->
    <template v-else-if="!handle.disabled && isHandleVisible(handle.id)">
      <Handle
        type="source"
        :position="(handle.position ? handle.position : getHandlePosition(handle.left, handle.top)) as Position"
        :id="handle.id"
        :style="{ left: handle.left, top: handle.top, opacity: handleOpacity(handle.id) }"
        :class="[
          'handle',
          handle.id === 'center-overlay' ? Z_INDEX.HANDLE_OVERLAY : Z_INDEX.HANDLE,
          handle.id === 'center' || handle.id === 'center-overlay' ? 'center-handle' : '',
          handle.id === 'center-overlay' ? centerOverlayClasses() : [],
          handle.id !== 'center' && handle.id !== 'center-overlay' ? `facing-${getHandleFacing(handle.left, handle.top)}` : '',
          isIdle(handle.id) && !isConnecting ? 'handle-default' : '',
          isActive(handle.id) ? 'handle-active' : '',
          isPulsing(handle.id) ? 'pulsing-handle' : '',
          handleEdgeClass(handle.id)
        ]"
        @mouseenter="hoveredHandleId = handle.id === 'center-overlay' ? 'center' : handle.id"
        @mouseleave="(e: MouseEvent) => { if (!(e.relatedTarget as HTMLElement)?.closest?.('.vue-flow__handle')) hoveredHandleId = null }"
      />
    </template>
  </template>
</template>
