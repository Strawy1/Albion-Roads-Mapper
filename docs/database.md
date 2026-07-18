# Database Schema

PostgreSQL, managed by `node-pg-migrate`. Migrations live in `web/server/migrations/` (JS files); tracking table `pgmigrations`. `initDb()` in `web/server/src/db.ts` runs them on server boot. Connection via a single `pg.Pool` from `DATABASE_URL`.

## Core tables

### `rooms`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | **Is** the vanity slug (`/^[a-z0-9-]+$/`) |
| `password_hash` | text NOT NULL | bcrypt cost 12 |
| `admin_password_hash` | text NOT NULL | Gates destructive/administrative actions |
| `home_zone_id` | text NOT NULL | Primary chain's source zone |
| `title` | text | ≤50 chars |
| `password_version` | int NOT NULL default 1 | Bumped on rotation; embedded in JWTs to invalidate them |
| `plotted_route` | text[] | Currently plotted route (zone ids) |
| `plotted_route_from_zone_id` / `plotted_route_to_zone_id` / `plotted_route_chain_id` | text | Route endpoints |
| `plotted_route_expires_at` | timestamptz | Snapshotted at plot time: MIN over route legs of each leg's connection expiry (route "active" check for `/metrics`); NULL when no route |
| `chain_migrated` | boolean NOT NULL default false | Lazy migration flag (backfilled on WS auth) |
| `created_at` | timestamptz NOT NULL default now | |
| `updated_at` | timestamptz | Drives abandoned-room cleanup |

### `connections`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `room_id` | text NOT NULL FK→rooms ON DELETE CASCADE | Index `idx_conn_room` |
| `from_zone_id` / `to_zone_id` | text NOT NULL | Must exist in the zone catalogue |
| `from_handle_id` / `to_handle_id` | text | Which portal handle on each zone |
| `expires_at` | timestamptz NOT NULL | +100 yr for `permanent` connections |
| `reported_at` | timestamptz NOT NULL default now | |
| `reported_by` | text | Free-text reporter name |
| `chain_id` | text FK→room_chains ON DELETE CASCADE | |
| `permanent` | boolean default false | Static world links (non-roads↔non-roads) |

### `room_node_positions` — where each zone sits on a room's canvas

| Column | Type | Notes |
|---|---|---|
| (`room_id`, `zone_id`) | PK | `room_id` FK→rooms CASCADE; index `idx_node_positions_room` |
| `x` / `y` | real | Vue Flow canvas coordinates |
| `features` | jsonb default `{}` | `NodeFeatures` — cores, reds, chests, resources, timers… |
| `custom_handles` | jsonb | User-edited handle layout (incl. disabled handles) |
| `explored` | boolean default false | |
| `rotation` | int default 0 | 0–3 clockwise 90° steps |
| `chain_id` | text FK→room_chains CASCADE | |

### `room_node_memory` — per-room history of roads zones

| Column | Type | Notes |
|---|---|---|
| (`room_id`, `zone_id`) | PK | index `idx_room_node_memory_room` |
| `times_added` | timestamptz[] NOT NULL default `{}` | Sighting timestamps, deduped to >3 h apart |
| `features` / `custom_handles` / `rotation` | jsonb / jsonb / int | Last-known layout, restored when the zone reappears |
| `last_updated` | timestamptz NOT NULL default now | |

### `room_chains`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `room_id` | text NOT NULL FK→rooms CASCADE | index `idx_room_chains_room` |
| `source_zone_id` | text NOT NULL | Chain root |
| `chain_number` | int | 1 = primary (home zone); MAX+1 on insert |
| `chain_color` | text | Hex; defaults via `defaultChainColor()` from the shared palette |
| `created_at` | timestamptz NOT NULL default now | |

## Analytics tables

Written by `src/analytics.ts` / `src/analyticsCron.ts`; read by `/metrics`. No FKs to `rooms` (they survive room deletion). All daily bucketing uses Europe/London.

- **`analytics_global_daily`** — `date` PK; counters: `rooms_created/modified/reset/deleted/aborted/abandoned`, `memory_wiped_full/single`, `passwords_rotated`, `active/inactive/total_rooms`, `peak_concurrent`, `unique_tokens_active`, `zones_added`, `non_roads_zones_added`, `room_data_updates`, `routes_plotted`, `tokens_issued`.
- **`analytics_hourly_connections`** — `hour` PK; `max/min_connections`, `avg_connections` numeric, `sample_count`.
- **`analytics_room_daily`** — (`room_id`, `date`) PK; `data_updates`, `zones_added_roads/nonroads`, `peak_concurrent`, `unique_tokens`, `routes_plotted`, `tokens_issued`.
- **`analytics_room_alltime`** — `room_id` PK; same counters, all-time; plus `routes_last_plotted_at` timestamptz (exact time of last route plot; NULL for pre-column history — `/metrics` falls back to the daily buckets).
- **`analytics_global_alltime`** — singleton row (`id` = 1); `rooms_aborted`, `rooms_abandoned`, `routes_last_plotted_at` timestamptz.

## Operational notes

- **Local DB:** `pnpm db:up` starts Postgres 16 in Docker (see [development.md](development.md)); data persists in `provisioning/volumes/db-data/` (a bind-mounted datadir — never commit or hand-edit).
- **Tests never touch Postgres** — the entire pool is mocked (see [testing.md](testing.md)).
- **Adding a migration:** drop a new timestamped JS file in `web/server/migrations/`; it runs automatically on next server boot, or explicitly via `pnpm --filter server migrate`.
- Positions are commonly updated via **delete+reinsert** (preserving `chain_id`) rather than UPDATE — be careful when adding columns to `room_node_positions` that the reinsert paths (`operations/update_node_positions.ts`, import, relocate) carry them through.
