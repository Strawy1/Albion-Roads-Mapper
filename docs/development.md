# Development & Operations

## Local setup

```bash
# 1. Env files (see below)
# 2. Start Postgres 16 in Docker and wait for readiness
pnpm db:up
# 3. Install deps
pnpm install
# 4. Build once so shared/dist exists (server imports shared's built output)
pnpm build
# 5. Run client (5173) + server (3001) together
pnpm dev
```

Client dev server: http://localhost:5173, proxying `/api` and `/ws` to the API on :3001.

**Gotcha:** `pnpm dev` does **not** watch `web/shared` — it's prebuilt. After editing shared code, re-run `pnpm --filter shared build` for the *server* to pick it up (the client aliases `shared` to source, so Vite sees shared edits live; the server consumes `dist/`).

## Env files

- `web/server/.env`: `DATABASE_URL` (required), `JWT_SECRET`, `PORT` (3001), `HOST` (0.0.0.0), optionally `MEDIA_PATH`.
- `provisioning/.env`: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` (compose defaults: `user`/`password`/`dbname`). Keep `POSTGRES_DB` and the database name inside `DATABASE_URL` in sync.
- Client: `VITE_API_URL` overrides the API base in non-dev builds (`web/client/src/utils/api.ts`); Vercel `preview` deployments hardcode `https://api-testing.albionroads.live`.

## Root scripts (`package.json`)

| Script | Does |
|---|---|
| `pnpm dev` | client + server dev servers in parallel |
| `pnpm db:up` / `db:down` | `scripts/start-local-db.sh` (compose up `db` + `pg_isready` poll) / compose down |
| `pnpm build` | ordered: shared → server → client |
| `pnpm test` / `pnpm lint` | recursive across all packages |
| `pnpm format` | prettier over `web/**` |
| `pnpm changelog` | interactive git-cliff, prepends to `CHANGELOG.md` |
| `pnpm --filter map-parser sync-maps` | regenerate `web/shared/data/maps.json` from upstream ([data-pipeline.md](data-pipeline.md)) |
| `pnpm --filter server seed` | seed fixtures (`web/server/fixtures/seed.ts`) |
| `pnpm --filter server migrate` | run migrations explicitly (they also run on server boot) |

Other tooling: `web/server/scripts/generate-hash.ts` (bcrypt hash utility), `scripts/build-docker.sh` (see below).

## Docker / deployment

- **`provisioning/Dockerfile`** — two-stage: `node:24` builder (`pnpm install --frozen-lockfile`, build shared + server) → `node:24-slim` runtime with `server/dist`, `server/migrations`, `server/fixtures`, `shared/dist`, `shared/data`, and `media/`. Exposes 3001, `CMD pnpm --filter server start`.
- **`scripts/build-docker.sh`** — builds/pushes `maelstromeous/applications:dig-roadmap-latest` (linux/amd64); pass `test` for the `-testing` tag. Requires `media/*.mp4` to exist locally.
- **`provisioning/docker-compose.yml`** — services: `db` (postgres:16-alpine, port 5432, bind mount `provisioning/volumes/db-data/`), `server` (prod image, :3001), `server-testing` (testing image, host :3002, uses `DATABASE_URL_TESTING`).
- Client deploys to Vercel; the server image runs behind a Cloudflare tunnel. `/metrics` is IP-allowlisted to localhost + `10.0.1.0/24` (Prometheus scrape network) — the tunnel subnet is deliberately blocked.

## Releasing

- Version lives in root `package.json`; the client displays it via `__APP_VERSION__`.
- `pnpm changelog` drives `CHANGELOG.md` via git-cliff (`cliff.toml`); commits follow conventional-commit style (`fix:`, `feat:` — see git log).
