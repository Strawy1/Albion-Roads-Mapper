# WebSocket Protocol

Route: `GET /ws/rooms/:id` — handler in `web/server/src/ws.ts`; broadcast registry in `web/server/src/broadcast.ts`; heartbeat in `web/server/src/marcopolo.ts`. The `ClientMessage`/`ServerMessage` discriminated unions are the source of truth: `web/shared/src/types.ts` (bottom of file). The client half lives in `useRoomStore.connect()/applyMessage()` (`web/client/src/stores/useRoomStore.ts`).

## Handshake

1. Client opens `ws(s)://…/ws/rooms/:id`. The server starts a **10 s auth timeout**; no auth in time → close `4401 "Authentication required"`.
2. Client sends `{ type: 'auth', token }` (`src/operations/auth.ts`). Bad token → close `4401 "Invalid token"`; token for another room → close `4401 "Token room mismatch"`.
3. On success the socket is registered in the room's broadcast set and receives, in order:
   - `{ type: 'auth_ok' }`
   - `{ type: 'sync', connections, homeZoneId, title?, nodePositions, lastUpdatedAt, watching, totalConnected, plottedRoute?, plottedRouteFromZoneId?, plottedRouteToZoneId?, plottedRouteChainId?, chains?, locked? }` — full room state. Connections are filtered to permanent-or-within-6h-grace.
   - `{ type: 'memory_sync', memory: RoomMemoryEntry[] }` — roads/roadsHideout zones only.
4. Any other message while unauthenticated → close `4401 "Not authenticated"`. Invalid JSON → `{ type: 'error', message: 'Invalid JSON' }`.
5. Each mutating operation re-verifies the stored token via `verifyWriteAccess()` (`ws.ts`); on token failure the server sends `session_expired` and closes `4401`. Close code `4401` tells the client **not** to auto-reconnect (it redirects to the auth page instead); any other close triggers exponential-backoff reconnect (1 s → 30 s). `verifyWriteAccess()` also runs the room-lock guard (`utils/roomGuard.ts`): when the room is **locked** and the session token lacks `role: 'admin'`, the mutation is rejected with `{ type: 'error', message: 'Room is locked' }` — the socket stays open, so read-only viewers keep receiving broadcasts.
6. **Lazy chain migration:** if `rooms.chain_migrated` is false at auth time, the server backfills the primary chain in a transaction and broadcasts `force_reload` instead of syncing.

## Client → server messages

| Type | Payload | Handler | Effect |
|---|---|---|---|
| `auth` | `{ token }` | `operations/auth.ts` | Handshake (above) |
| `ping` | `{ zoneName, nodeId? }` | inline in `ws.ts` | Re-broadcast to the room as a server `ping` (user "ping this zone" feature) |
| `polo` | — | `marcopolo.ts` | Heartbeat reply |
| `create_connection` | `{ fromZoneId, toZoneId, fromHandleId?, toHandleId?, secondsRemaining, slots?, reportedBy?, targetPosition?, permanent? }` | `operations/create_connection.ts` | Same rules as HTTP POST plus an explicit duplicate-edge check |
| `update_node_positions` | `{ nodePositions, updateLastUpdated? }` | `operations/update_node_positions.ts` | Dedup by zoneId, rotation self-heal, delete+reinsert preserving `chain_id`, roads memory update |
| `rotate_zone` | `{ zoneId, rotation, customHandles? }` | `operations/rotate_zone.ts` | Normalizes rotation, canonicalizes handles under a `FOR UPDATE` room lock, upserts the memory mirror and broadcasts `memory_updated`. When `customHandles` is present (the ZoneHandleEditor save path) it is the source of truth for the handle set; otherwise the stored handles are used. The resulting single-row `node_positions_updated` goes to **all clients including the sender** — this is what lets the editing user see their own portal changes live (previously the editor saved via `rotate_zone` + `update_node_positions`, and the rotate echo carried stale handles back to the sender while the handles broadcast excluded them) |
| `update_plot_route` | `{ plottedRoute, fromZoneId?, toZoneId?, chainId? }` | `operations/update_plot_route.ts` | Persists the plotted route on `rooms` |

Operation plumbing: `src/operations/types.ts` (`OperationContext` / `OperationHandler`).

## Server → client messages

| Type | Payload | When |
|---|---|---|
| `auth_ok` | — | Handshake success |
| `sync` | full room state (see handshake) | After auth |
| `connection_added` / `connection_updated` | `{ connection }` | Create / PATCH |
| `connection_removed` | `{ connectionId?, removedZoneIds? }` | Delete (includes orphaned zones removed alongside); node deletion sends empty `connectionId` |
| `connection_expired` | `{ connectionId }` | Expiry job, within ~60 s of expiry |
| `node_positions_updated` | `{ nodePositions, updateLastUpdated? }` | Any node mutation — see broadcast semantics below |
| `room_updated` | `{ homeZoneId }` | Home zone change |
| `room_reset` | — | Connections reset or import (client re-syncs) |
| `room_title_updated` | `{ title }` | Title change |
| `chain_added` / `chain_updated` | `{ chain }` | Chain CRUD |
| `chain_removed` | `{ chainId, removedZoneIds, removedConnectionIds }` | Chain delete |
| `chain_relocated` | `{ chain, removedZoneIds, removedConnectionIds, newHomeZoneId?, newSourceNodePosition }` | Chain relocate |
| `memory_sync` | `{ memory }` | After auth; after full memory wipe (empty array) |
| `memory_updated` / `memory_deleted` | `{ entry }` / `{ zoneId }` | Memory changes |
| `plot_route_updated` | `{ plottedRoute, fromZoneId?, toZoneId?, chainId? }` | Route plotting |
| `ping` | `{ zoneName, nodeId? }` | Relayed user ping |
| `marco` | — | Heartbeat probe (client must reply `polo`) |
| `watching` | `{ roomId, count, totalConnected }` | Socket join/leave and each heartbeat cycle |
| `room_lock_changed` | `{ locked }` | Admin locked/unlocked the room via PATCH `/api/rooms/:id/lock` (sent to all sockets, including any admin sessions) |
| `password_rotated` / `room_deleted` / `session_expired` | (`session_expired` has `{ reason }`) | Client clears its token and redirects to the auth page with a reason banner |
| `force_reload` | — | Client must reload (e.g. after lazy chain migration) |
| `error` | `{ message }` | Bad JSON / operation errors |

## Broadcast semantics

- Registry: `roomSockets: Map<roomId, Set<WebSocket>>` — **authenticated sockets only** (`broadcast.ts`).
- `broadcast(roomId, message, exclude?)` serializes once and sends to every open socket in the room; `exclude` is used for echoes the sender already applied optimistically (e.g. `update_node_positions`, `update_plot_route` exclude the sender). `rotate_zone` deliberately does **not** exclude the sender — its echo is the authoritative reapply for handle/rotation edits. A mutation whose authoritative result must reach the sender therefore cannot ride on an excluded broadcast issued by a *different* message (this was the hideout-portal-save bug).
- `broadcastAll(message)` reaches every socket in every room (used for global `watching` totals).
- **Full-array positions:** after most node mutations the server re-reads the room's *entire* `room_node_positions` set and broadcasts it as `node_positions_updated` — clients replace-merge rather than patch. Exceptions that send a **single-row** array: `POST /chains` (just the new source node, to avoid clobbering concurrent drags) and `rotate_zone`.
- Connections are *not* re-sent wholesale after the initial `sync`; they flow as granular `connection_*` events.

## Heartbeat (marco/polo)

One global interval (`marcopolo.ts`), started with the first socket, stopped when none remain:

- Every **15 s**: broadcast `{ type: 'marco' }` to all sockets.
- **5 s** later: sockets that didn't reply `polo` are closed with `1001 "No polo response — connection assumed dead"`, then per-room `watching` counts (responders only) are broadcast.

The client replies to `marco` with `polo` automatically in `applyMessage`.
