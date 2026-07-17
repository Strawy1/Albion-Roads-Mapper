# Client (`web/client`)

Vue 3 + TypeScript SPA (Vite, `<script setup>`), TailwindCSS + some SCSS, Pinia, vue-router, and `@vue-flow/core` for the map canvas. Imports the `shared` workspace package (aliased to source: `shared` → `../shared/src/index.ts` in both `vite.config.ts` and `tsconfig.json`; `@` → `src/`).

## Structure

- **Entry:** `src/main.ts` → `src/App.vue` (RouterView + Vercel Analytics in prod).
- **Routes** (`src/router/index.ts`):
  - `/` → `src/views/LandingPage.vue` — marketing/tutorial page with chaptered demo video
  - `/create` → `src/views/CreateRoomView.vue` — room creation
  - `/rooms/:id/auth` → `src/views/RoomAuthView.vue` — password gate
  - `/rooms/:id` → `src/views/RoomView.vue` — **the map** (~1,700 lines; hosts the canvas and owns all connection-creation logic, toasts, toolbars)

## Pinia stores (`src/stores/`)

### `useRoomStore.ts` (id `room`) — the core store, owns the WebSocket

- **State:** `connections`, `homeZoneId`, `chains`, `nodePositions`, `roomTitle`, `roomId`, `wsStatus` (`disconnected|connecting|connected|auth_failed`), `lastUpdate`, `lastPing`, `watchingCount`, `totalConnected`, `disconnectReason`, UI flags for in-progress connecting/chain placement, and localStorage-persisted prefs (`shapeBackgroundOpacity`, `animationsEnabled`, `bluePromptsEnabled`, `recentlyViewedRooms`).
- **WS lifecycle:** `connect()` opens `${API_BASE_URL}/ws/rooms/:id` (http→ws protocol rewrite), sends `{type:'auth', token}` on open. Reconnects with exponential backoff (1 s → 30 s) on any close **except code 4401** (auth failure → redirect to auth page). `getToken()` always reads `localStorage['token:${roomId}']` live, never caches.
- **`applyMessage(msg: ServerMessage)`** is the inbound reducer — one case per server message type (see [websocket-protocol.md](websocket-protocol.md)). Replies `polo` to `marco` automatically.
- **Outbound writes:**
  - WS `send()`: `update_node_positions`, `rotate_zone`, `create_connection`, `update_plot_route`, `ping`, `polo`.
  - REST (Bearer token): import (PUT `/import`), chain CRUD (`addChain`, `updateChainColor`, `relocateChain`, `removeChain`), connection CRUD from the edge popover.
- **Domain logic:** isolation analysis (`isNodeIsolated`/`isEdgeIsolated` via `src/utils/treeQuery.ts` ancestor chains), chain friendly-id/color resolution, and `validateNodeRotations()` — cross-checks stored rotation vs inferred handle layout and auto-sends `rotate_zone` to self-heal desyncs.

### `useRoomMemoryStore.ts` (id `roomMemory`)

Thin `Map<zoneId, RoomMemoryEntry>` over room memory ("map history"), driven by the memory cases in `useRoomStore.applyMessage`.

### `usePlotRouteStore.ts` (id `plotRoute`)

Route-plotting state machine (`idle → selectingFrom → selectingTo`). Runs a local **BFS** over connections (bidirectional) to find the path between two same-chain zones; highlights plotted/reversed edges and ghost previews; broadcasts via `update_plot_route`; reacts to node/connection removal.

## The Vue Flow canvas (`RoomView.vue`)

- `<VueFlow>` with `nodeTypes = { zone: ZoneNode, 'non-roads': NonRoadsNode }`, `edgeTypes = { connection: ConnectionEdge }`, a custom `ConnectionLine` (`src/components/flow/ConnectionLine.vue`), `ConnectionMode.Loose`, min-zoom 0.1.
- **State → flow translation:** a deep watcher on `[homeZoneId, nodePositions, connections]` rebuilds `flowNodes`/`flowEdges`. Node type is `zone` for roads/roadsHideout, `non-roads` otherwise; `data` carries tier, name, `mapShape`, `customHandles`, `rotation`, `features`, `explored`, chain info, isolation. Reconciles via VueFlow `updateNode`, calling `updateNodeInternals` when handle sets change.
- **Positions are server-owned.** Dragging a node fires `onNodeDragStop` → store sends `update_node_positions`. The client never persists inferred positions itself (comments in RoomView explain the historical DELETE+reinsert footgun).
- **Nodes:** `ZoneNode.vue` draws a diamond with an optional rotated map-shape PNG (`/images/shapes/{mapShape}.png`), feature editors (cores/reds/chests/resources), ping/memory buttons, and the handle editor (`ZoneHandleEditor`). Handles are rendered by `ZoneNodeHandles.vue` from `getDefaultHandles(type, mapShape)` (shared) merged with saved `customHandles`, plus a synthetic `center` and a `center-overlay` snap target while connecting.
- **Edges:** `ConnectionEdge.vue` uses a custom bezier from `src/utils/connectionPath.ts` (handle facing directions → exit/entry angles). Animated SVG chevrons (scale with distance; static when animations disabled), countdown pill, slots badge (7/20), and an edit/delete popover. Colour from `src/utils/connectionStyle.ts`: green >60 m, orange <60 m, red <30 m, grey expired; plotted-route edges override to blue.
- **Countdowns:** one 1 s `setInterval` updates a provided `globalNow` ref that all edges/timers consume.
- **Summaries:** RoomView derives active cores/crystals/dungeons/chests/resources from node features, feeding `TopLeftToolbar`/`TopRightToolbar`/`MobileRoomSummary`.

## Connection creation

VueFlow `@connect-start` / `@connect` / `@connect-end` → `handleConnect()` in RoomView:

- Drop on a node/handle → create/update the connection directly (WS `create_connection`).
- Drop on empty canvas → spawn a **ghost node + ghost edge** and open `ReportForm.vue` to pick the destination zone and portal time.
- New chains use ghost-on-cursor placement (`beginPlacingChain` / `onPendingChainClick`) → `store.addChain(zoneId, {x, y})`.

## Auth, room join & client-side validation

- **Create:** POST `/api/rooms`, then immediately POST `/auth` for a JWT → `localStorage['token:${id}']`. Vanity slug availability debounce-checked via `/api/slugs/check/:slug`; auto-generated from title or `unique-names-generator`.
- **Join:** `RoomAuthView` resolves the room (`/api/rooms/resolve/:id`), skips straight in if a token exists, else POSTs the password. Reason banners come from `?reason=password_rotated|room_deleted|session_expired`.
- **In-room:** `RoomView.initializeRoom` sets credentials and connects; `wsStatus === 'auth_failed'` clears the token and redirects to auth with the reason.
- **Client-side validations** (UX layer — the server re-validates everything): same-zone, cross-chain, disabled handles, one-connection-per-portal; occupied-target confirmation modal; reverse-duplicate normalization; roads↔non-roads rules; `wouldCreateLongerLoop` (shared) warnings; Royal-vs-Outlands compatibility filtering in `ReportForm`; permanent-connection derivation for non-roads↔non-roads.

## Build & dev

- Scripts: `dev` (vite, port 5173), `build` (`vue-tsc --noEmit && vite build`), `preview`, `test` (`vitest run`), `lint`.
- **Dev proxy** (`vite.config.ts`): `/api` → `http://localhost:3001`, `/ws` → `ws://localhost:3001` (upgrade). In non-dev, `src/utils/api.ts` picks the base URL: Vercel `preview` env → `https://api-testing.albionroads.live`, else `VITE_API_URL` or `http://localhost:3001`.
- Injected globals: `__APP_VERSION__` (root package.json), `__APP_COMMIT_SHA__`, `__VERCEL_ENV__`.
- Deployed on Vercel (client) against the Dockerised API.
