# Server (`web/server`)

Fastify 5 (ESM, TypeScript) with a `pg` Pool, `@fastify/jwt`, `@fastify/websocket`, rate limiting, and CORS. Zod schemas come from `web/shared/src/types.ts`.

## Startup & configuration

- **Entry:** `web/server/src/index.ts` — loads dotenv, runs `initDb()` (node-pg-migrate `up`, migrations table `pgmigrations`), builds the app via `buildApp({ db })`, starts three background intervals, listens on `PORT`/`HOST`.
- **App factory:** `web/server/src/app.ts` — `buildApp({ db, jwtSecret?, logger?, disableRateLimit? })`. Registers CORS, the `db` decorator, JWT, the `authenticate` preHandler, rate limiting, websocket, then route plugins: rooms, connections, ws, health, media, metrics.
- **Env vars** (`web/server/.env.example`): `DATABASE_URL` (required), `JWT_SECRET` (default `change-me-in-production`), `PORT` (3001), `HOST` (0.0.0.0), `MEDIA_PATH` (media dir for the demo video).
- **Scripts:** `dev` (tsx watch), `build` (tsc), `start` (node dist), `test` (vitest run), `seed` (`fixtures/seed.ts`), `migrate`.

## Auth model

- `POST /api/rooms/:id/auth` verifies the room password (bcrypt, cost 12) and signs a JWT `{ roomId, passwordVersion }` with **7-day** expiry.
- `POST /api/rooms/:id/auth/admin` verifies the room's **admin password** (against `admin_password_hash` only — the room password can never mint an admin token) and signs `{ roomId, passwordVersion, role: 'admin' }` (7-day). The `role` claim is set exclusively on this signing path (`RoomTokenPayload` in shared). The client swaps its stored token for the admin one (one token per room).
- The `authenticate` preHandler (`app.ts`) verifies the JWT, then runs the **room guard** (`src/utils/roomGuard.ts`, single `ROOM_GUARD_SQL` query): it checks `passwordVersion` against `rooms.password_version` (password rotation bumps the version and invalidates all outstanding tokens) and enforces the **room lock** — when `rooms.locked` is true, every non-GET request from a token without `role: 'admin'` gets 403 `Room is locked`. This is a chokepoint: new mutating routes are covered automatically.
- Every mutating room/connection route also requires `jwtPayload.roomId === :id` (else 403). A token grants access to exactly one room; admin tokens are equally room-scoped.
- Destructive/administrative actions additionally require the room's **admin password** in the request body: password change, title change, memory wipe, room delete (optional on connections-reset).
- `PATCH /api/rooms/:id/lock` `{ locked }` toggles the lock; it requires an admin-role token even while unlocked, and broadcasts `room_lock_changed`.

## HTTP routes

Validation failures return 400 with a formatted Zod error. All schemas live in `web/shared/src/types.ts`.

### Rooms — `web/server/src/routes/rooms.ts`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/rooms/resolve/:slug` | none | `{ id }` or 404 |
| GET | `/api/slugs/check/:slug` | none | `{ available }`; slug must match `/^[a-z0-9-]+$/`, ≤100 chars |
| POST | `/api/rooms` | none (rate-limited) | `{ password, adminPassword, homeZoneId, title?, vanityUrl }` → 201 `{ id, shareUrl }`. Room id **is** the vanity slug. Creates room + primary chain + home-zone position + memory in a transaction. 409 if slug taken |
| POST | `/api/rooms/:id/auth` | none (rate-limited) | `{ password }` → `{ token }`; 401 bad password |
| POST | `/api/rooms/:id/auth/admin` | none (rate-limited) | `{ adminPassword }` → `{ token }` with `role: 'admin'`; 401 bad admin password. Compares only `admin_password_hash`, scoped to `:id` |
| PATCH | `/api/rooms/:id/lock` | JWT (admin role) | `{ locked: boolean }` → `{ ok, locked }`; 403 without admin role. Broadcasts `room_lock_changed` |
| PATCH | `/api/rooms/:id/password` | JWT + admin pw | Bumps `password_version`; broadcasts `password_rotated` |
| PATCH | `/api/rooms/:id/title` | JWT + admin pw | Title ≤50 chars; broadcasts `room_title_updated` |
| POST | `/api/rooms/:id/chains` | JWT | `{ sourceZoneId, x?, y? }` → 201 `{ chain }`. 409 if zone already in a chain. Broadcasts `chain_added` (+ single-row `node_positions_updated`) |
| PATCH | `/api/rooms/:id/chains/:chainId` | JWT | `{ chainColor }` (hex `#RRGGBB`); broadcasts `chain_updated` |
| POST | `/api/rooms/:id/chains/:chainId/relocate` | JWT | `{ sourceZoneId }` — wipes the chain's connections/positions/memory, re-roots at the old coords; updates `home_zone_id` if primary chain. Broadcasts `chain_relocated` |
| DELETE | `/api/rooms/:id/chains/:chainId` | JWT | 400 if primary chain. Cascades to connections/positions/memory. Broadcasts `chain_removed` |
| DELETE | `/api/rooms/:id/connections` | JWT (admin pw optional) | Room reset: deletes all connections + non-source positions, wipes features on chain sources. Broadcasts `room_reset` |
| DELETE | `/api/rooms/:id/memory` | JWT + admin pw | Wipes all room memory; broadcasts empty `memory_sync` |
| DELETE | `/api/rooms/:id/memory/:zoneId` | JWT | Broadcasts `memory_deleted` |
| DELETE | `/api/rooms/:id` | JWT + admin pw | Deletes the room and all dependents; broadcasts `room_deleted` |
| PUT | `/api/rooms/:id/import` | JWT | `ImportRoomBodySchema` — full state replace; chain membership re-derived by BFS from each chain source. Broadcasts `room_reset` |

### Connections — `web/server/src/routes/connections.ts`

| Method | Path | Notes |
|---|---|---|
| GET | `/api/rooms/:id/connections` | Connections that are permanent or within the 6 h expiry grace window |
| POST | `/api/rooms/:id/connections` | `CreateConnectionBodySchema`. Upserts target node position, records roads memory (3 h dedup), inserts connection. Broadcasts full-array `node_positions_updated` + `connection_added` (+ `memory_updated`). Expiry = `secondsRemaining` or +100 yr if `permanent` |
| PATCH | `/api/rooms/:id/connections/:connId` | `{ secondsRemaining?, fromHandleId?, toHandleId? }`. Broadcasts `node_positions_updated` + `connection_updated` |
| DELETE | `/api/rooms/:id/connections/:connId` | Also removes orphaned endpoint zones (no remaining connections, not chain source/home). One `connection_removed` broadcast with `connectionId` + `removedZoneIds` |
| DELETE | `/api/rooms/:id/nodes/:zoneId` | Deletes an orphan node (400 if home zone or chain source). `connection_removed` with empty `connectionId` |

`Connection` wire shape: `{ id, roomId, fromZoneId, toZoneId, fromHandleId?, toHandleId?, expiresAt, reportedAt, reportedBy?, chainId?, permanent? }`.

### Other routes

- `GET /api/health` — `{ status: 'ok', roomCount }` (`routes/health.ts`).
- `GET /api/media/demov1-1.mp4` — Range-capable video streaming from `MEDIA_PATH` (`routes/media.ts`).
- `GET /metrics` — Prometheus text format, **IP-allowlisted** (localhost + `10.0.1.0/24` only), no JWT (`routes/metrics.ts`). ~40 `albionmapper_*` metric families; timezone math is Europe/London.

### Rate limits

`POST /api/rooms` → 10/hour/IP; `POST /api/rooms/:id/auth` → 20/hour/IP. Disabled in tests via `disableRateLimit`.

## Business-rule validation

Beyond Zod shape checks, enforced in route/operation code:

- Zone ids must exist in `ZONE_BY_ID` (the shared catalogue).
- No same-zone connections (`from === to`).
- **Chain membership:** the source zone must already be on the map with a `chain_id`; the target must not belong to a *different* chain (no cross-chain bridges).
- **No duplicate edges** (WS create): rejects a connection duplicating an existing edge in either direction.
- **Handle occupancy:** an existing non-expired connection on the same source handle (with `center` normalized) → 400.
- **Disabled handles** (HTTP create): `custom_handles` entries with `disabled: true` on either endpoint → 400.
- **Rotation/handle self-heal:** `operations/update_node_positions.ts` and `operations/rotate_zone.ts` re-infer rotation from handles (`shared/src/rotation.ts`) and canonicalize when stored rotation disagrees — handles win.
- **Memory dedup:** roads-zone sighting timestamps appended only if >3 h since the last one.
- `CreateConnectionBodySchema` `superRefine`: `secondsRemaining` (1–86400) and `slots` (7 or 20) required unless `permanent`.

## Background jobs

Started in `index.ts`, cleared on shutdown:

| Job | File | Interval | What it does |
|---|---|---|---|
| Expiry cleanup | `src/expiry.ts` | 60 s | Broadcasts `connection_expired` for freshly expired connections; hard-deletes connections older than the 6 h grace (`EXPIRE_GRACE_MS`), broadcasting `connection_removed` |
| Analytics cron | `src/analyticsCron.ts` | 60 s | Flushes in-memory concurrency/unique-token stats to the analytics tables; hourly connection buckets; daily rollover at Europe/London midnight |
| Room cleanup | `src/roomCleanup.ts` | 1 h (runs immediately) | Deletes **aborted** rooms (empty, >48 h old) and **abandoned** rooms (stale >5 days), tracking counts in analytics |

In-memory analytics state lives in `src/broadcast_analytics.ts` (per-room peak concurrency + JWT-signature-fingerprint unique tokens), flushed each minute by the cron.
