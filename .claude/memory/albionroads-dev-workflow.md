---
name: albionroads-dev-workflow
description: "How to build, run, and test albionroads (pnpm monorepo) — including the shared-rebuild and mocked-DB test facts"
metadata: 
  node_type: memory
  type: project
  originSessionId: 13f760d6-3b0a-468f-9b88-b5234e3b6a26
---

pnpm workspace monorepo: `web/client` (Vue 3 + Vue Flow), `web/server` (Fastify + pg + WS), `web/shared` (types/Zod/zone catalogue), `map-parser` (data generator).

**Why:** commands and test assumptions here are non-obvious and easy to get wrong.

**How to apply:**
- Run: `pnpm db:up` (Postgres 16 in Docker) → `pnpm install` → `pnpm build` → `pnpm dev` (client :5173 proxies to server :3001).
- `pnpm dev` does NOT watch `web/shared`; after editing shared code, run `pnpm --filter shared build` or the server won't see the change (client aliases shared to source, so Vite does see it live).
- Tests: `pnpm test` (all) or `pnpm --filter <pkg> test`; single server file: `pnpm --filter server exec vitest run test/ws.test.ts`.
- **Server tests never use a real database** — they inject a mocked `pg.Pool` into `buildApp()` and assert on `mockDb.query.mock.calls` / stacked `mockResolvedValueOnce` in query order (reordering queries in a handler breaks mocks). They run serially (`singleFork: true`) because broadcast/heartbeat state is module-global. Helper: `web/server/test/testApp.ts` → `setupTestApp()`.
- WS tests connect a real `ws` client to `app.listen({ port: 0 })` — the handshake/broadcast paths are exercised for real.
- Migrations auto-run on server boot (`node-pg-migrate`, `web/server/migrations/`).
- Zone data changes go through `pnpm --filter map-parser sync-maps`, never hand-edit `web/shared/data/maps.json`.
- `sync-maps` now ALSO fetches static Roads metadata from Albion Maps (albionmaps.com.br): per-zone search pages, parsed in `map-parser/src/albionmaps/`. Flags: `--no-albionmaps` (skip), `--albionmaps-source <file>` (offline cache, tests). Failure aborts before the atomic write. ~400 requests × ~0.5s + 150ms delay ≈ 3-4 min for a full sync.
- `pnpm lint` is BROKEN upstream: eslint is not a dependency of any workspace package (lockfile has zero eslint entries). Don't run it; rely on `pnpm build` (vue-tsc/tsc) + `pnpm test`.

Details in `docs/testing.md` and `docs/development.md`. Related: [[albionroads-docs]], [[albionroads-gotchas]].
