# Albion Roads Mapper

A collaborative, real-time web application for *Albion Online* guild members to crowdsource and visualise temporary **Roads of Avalon** portal connections between zones.

Multiple users join a shared, password-protected room and contribute connection data which propagates to all participants over WebSockets in ~250 ms.

---

## Tech Stack

| Layer | Technologies |
|---|---|
| Language | TypeScript (strict mode) |
| Backend | Fastify, `@fastify/websocket`, `pg`, `bcrypt`, `zod` |
| Frontend | Vite + Vue 3 (`<script setup>`), TailwindCSS, `@vue-flow/core`, `reka-ui`, Pinia |
| Testing | `vitest`, `@testing-library/vue`, `@vue/test-utils`, `supertest` |
| Tooling | pnpm workspaces, `tsx` |

## Quick Start

Create `.env` files in `provisioning` and `web/server` (see below). Then run:

```bash
# 1. Start the local database (Postgres in Docker)
pnpm db:up

# 2. Install all dependencies
pnpm install

# 3. Perform a build so shared components are available
pnpm build

# 4. Start both server and client (concurrently)
pnpm dev
```

The client dev server runs on **http://localhost:5173** (proxied to the API server on **:3001**).

---

## Project Structure

```
albionroads/
├── web/
│   ├── client/         # Vue 3 SPA — components, stores, composables
│   │   ├── src/
│   │   └── test/
│   ├── server/         # Fastify API — HTTP routes, WS, PostgreSQL, expiry
│   │   ├── src/
│   │   ├── migrations/ # Database migrations (node-pg-migrate)
│   │   ├── fixtures/   # Data seeding
│   │   └── test/
│   └── shared/         # Domain types, Zod schemas, zones adapter
│       ├── src/
│       ├── data/       # maps.json (committed, updated by sync-maps)
│       └── test/
├── map-parser/         # Standalone parser that populates web/shared/data/maps.json
├── package.json
└── pnpm-workspace.yaml
```

---

## Running Tests

```bash
# All packages at once
pnpm test

# Individual packages
pnpm --filter map-parser test
pnpm --filter shared test
pnpm --filter server test
pnpm --filter client test
```

**Test counts (all green):**
- `map-parser` — 57 tests (data classification, sync logic)
- `shared` — 97 tests (zones adapter, categorization, rotation, connections)
- `server` — 251 tests (rooms, connections, chains, expiry, WebSocket, analytics)
- `client` — 288 tests (stores, components, connection/handle geometry, utils)

---

## Features

### Reporting Flow
Open a room → click or tab into **From zone**, type to search, pick a zone → tab to **To zone** → tab to **time** (enter as `H:MM` or plain minutes) → **Enter** to submit.

### Visualisation (Vue Flow)
- Home zone centred at (0,0); direct neighbours at radius 220 px; second-degree at 440 px.
- Edge colours: **green** (> 30 min), **amber** (10–30 min), **red dashed** (< 10 min), **grey dashed** (stale, within 6 h grace).
- Live countdown on each edge (`MM:SS` or `Hh MMm`).
- Click a node → sets it as the new home zone (broadcasts to all clients).
- Click an edge → opens a popover with reporter, timestamp, and a **Delete** button.

### Real-time Sync
WebSocket at `/ws/rooms/:id`. Authenticated via JWT (sent as first `auth` message). All writes go through REST; WS fans out `connection_added`, `connection_removed`, and `room_updated` events to every authenticated subscriber in the same room.

### Security
- Passwords hashed with `bcrypt` (cost 12).
- Per-room JWT (7 days, invalidated on password rotation) for API and WS auth.
- Rate limiting: `POST /api/rooms` → 10/hour/IP; `POST /api/rooms/:id/auth` → 20/hour/IP.
- Zone validation on every connection submission (both IDs must exist in catalogue, must differ).

---

## Data Sources

**Static zone metadata is imported from [Albion Maps](https://www.albionmaps.com.br/?lang=en)** (community project, not affiliated with Sandbox Interactive) by `map-parser`:

- Tier, zone type (HO / TUNNEL / GROUP PORTAL), chest counts (large/small gold, blue, green), dungeon count, and resource presence are fetched at sync time and committed into `web/shared/data/maps.json`.
- The data is authoritative and rendered read-only in the UI — users never enter or override chests, resources, tiers, or dungeon counts.
- Everything **live** stays user-entered: portal connections, timers, reds, power cores, timed chests, crystal creature, rotations, handles.

### Running the sync

```bash
# Full sync: upstream zone feed + Albion Maps static metadata (network)
pnpm --filter map-parser sync-maps

# Offline / test runs (no network):
pnpm --filter map-parser sync-maps -- --source ./fixture.json --albionmaps-source ./cached-cards.json --output /tmp/maps.json
```

Flags: `--source <file>` (upstream feed fixture), `--albionmaps-source <file>` (cached Albion Maps responses keyed by zone name), `--no-albionmaps` (skip the Albion Maps stage), `--output <path>`, `--strict` (abort on any warning).

### Failure behaviour

- If Albion Maps is unreachable or returns unparseable data, the sync **aborts before writing** — the previous `maps.json` stays intact and the app keeps working. Albion Maps is never contacted at runtime.
- Zones the site does not carry are reported as unmatched (12 today) and keep their feed-derived fallback data. Zone matching is exact after name normalization; ambiguous or near-miss spellings are never guessed.
- Output is deterministic — re-running the sync produces a byte-identical `maps.json` (no timestamps, stable ordering).

---

## Environment Variables (server)

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | - | PostgreSQL connection string (required) |
| `JWT_SECRET` | `change-me-in-production` | HMAC secret for JWT signing |
| `PORT` | `3001` | Server listen port |
| `HOST` | `0.0.0.0` | Server listen host |
