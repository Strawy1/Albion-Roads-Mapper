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
5. Each mutating operation re-verifies the stored token via `verifyWriteAccess()` (`ws.ts`); on token failure the server sends `session_expired` and closes `4401`. Close code `4401` tells the client **not** to auto-reconnect (it redirects to the auth page instead); any other close triggers stepped-backoff reconnect (see Reconnect backoff below). `verifyWriteAccess()` also runs the room-lock guard (`utils/roomGuard.ts`): when the room is **locked** and the session token lacks `role: 'admin'`, the mutation is rejected with `{ type: 'error', message: 'Room is locked' }` — the socket stays open, so read-only viewers keep receiving broadcasts.
6. **Lazy chain migration:** if `rooms.chain_migrated` is false at auth time, the server backfills the primary chain in a transaction and broadcasts `force_reload` instead of syncing.

## Client → server messages

| Type | Payload | Handler | Effect |
|---|---|---|---|
| `auth` | `{ token }` | `operations/auth.ts` | Handshake (above) |
| `ping` | `{ zoneName, nodeId? }` | inline in `ws.ts` | Re-broadcast to the room as a server `ping` (user "ping this zone" feature) |
| `polo` | — | `marcopolo.ts` | Reply to a **server-initiated** `marco` (server-side liveness) |
| `marco` | — | inline in `ws.ts` | **Client-initiated** liveness probe; server replies `polo` to that socket only (see Heartbeat) |
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
| `marco` | — | Server-initiated heartbeat probe (client must reply `polo`) |
| `polo` | — | Reply to a **client-initiated** `marco` (client-side liveness); sent only to the probing socket |
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

## Heartbeat (marco/polo — bidirectional)

marco/polo is **symmetric**: either side can send `marco` and the peer replies `polo`. This covers two distinct failure modes.

**Server → client (server-side liveness / watching counts).** One global interval (`marcopolo.ts`), started with the first socket, stopped when none remain:

- Every **15 s**: broadcast `{ type: 'marco' }` to all sockets.
- **5 s** later: sockets that didn't reply `polo` are closed with `1001 "No polo response — connection assumed dead"`, then per-room `watching` counts (responders only) are broadcast.
- The client replies to a server `marco` with `polo` automatically in `applyMessage`.

**Client → server (client-side liveness).** The server-driven probe can't help a client whose socket is *silently half-open* — e.g. the server restarts or the TCP connection is dropped with no RST. The client simply stops receiving marcos and gets **no `close` event**, so without its own check it sits "connected" forever and the `watching` count decays as those ghosts are never replaced. So the client runs its own probe (`useRoomStore.startHeartbeat()`), armed on `auth_ok`:

- Every **15 s** (`HEARTBEAT_INTERVAL_MS`), if no probe is already outstanding, send `{ type: 'marco' }` and arm a **5 s** timer (`POLO_TIMEOUT_MS`).
- **Any** inbound frame (`polo`, a broadcast, anything) clears the timer via `noteServerActivity()` — receiving traffic is proof of life.
- If the timer fires with no inbound frame, `handleConnectionLost()` force-closes the socket (nulling `ws` first so the stale close handler no-ops) and schedules a reconnect.
- The server replies to a client `marco` with `polo` to **that socket only** (inline in `ws.ts`) — it does not affect the server's own marco cycle or `poloResponders`.

**Wake healing.** A backgrounded tab has its `setInterval`/`setTimeout` throttled, so both the probe and the reconnect backoff can stall for a minute+. While a session is live the client also listens for `visibilitychange` (→ visible) and `online` (`attachWakeListeners()` on `connect`, removed on `disconnect`). On either, `wakeCheck()` probes an open socket immediately, or — if the socket is already gone — clears the pending backoff, resets `reconnectAttempts`, and reconnects now. This heals ghost tabs the instant the user looks at them rather than on the next throttled tick.

## Reconnect backoff (client)

Any non-`4401` close (or a client-detected dead connection) schedules a reconnect on a **stepped** schedule keyed on `reconnectAttempts` (`scheduleReconnect()`): **1 s** for the first 5 attempts, **10 s** for the next 5, **60 s** thereafter. `reconnectAttempts` resets to 0 on the next `auth_ok`. A `4401` close does **not** reconnect (redirects to auth instead).
