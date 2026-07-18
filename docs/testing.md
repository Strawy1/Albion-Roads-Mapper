# Testing

All four packages use **Vitest**. Run everything from the repo root:

```bash
pnpm test                          # all packages (pnpm --recursive test)
pnpm --filter server test          # one package
pnpm --filter server exec vitest run test/ws.test.ts   # one file
pnpm lint                          # eslint, all packages
```

## server (`web/server/test/`)

- **Config:** `web/server/vitest.config.ts` — node env, **`pool: 'forks'` with `singleFork: true`** (tests run serially in one process). This matters: the broadcast registry and marco/polo heartbeat use module-level global state, so parallel workers would interfere. Keep new tests compatible with serial execution and clean up sockets/intervals.
- **No real Postgres.** Every test injects a mocked `pg.Pool` — `{ query: vi.fn().mockResolvedValue({ rows, rowCount }), connect: vi.fn() }` — into `buildApp({ db: mockDb, disableRateLimit: true, jwtSecret })`. Migrations never run in tests. Assertions either inspect `mockDb.query.mock.calls` or stack `mockResolvedValueOnce` return values in query order (brittle if you reorder queries in a handler — update the mocks too).
- **Shared helper:** `test/testApp.ts` → `setupTestApp()` builds the app, awaits `app.ready()`, signs a test JWT (`{ roomId }`, secret `test-secret`). Used by most suites; others build their own inline `mockDb` and often `vi.mock('../src/broadcast.js')`.
- **Room-guard dispatch:** the `authenticate` preHandler and WS write gate issue `ROOM_GUARD_SQL` (`src/utils/roomGuard.ts`) on every authenticated mutating request. `setupTestApp()` (and `wrapDbWithGuardDispatch()` for suites with their own `mockDb`) routes that exact SQL to a separate mock so it never consumes the per-test `mockResolvedValueOnce` stack. Default guard result = room row absent → unlocked/version-check skipped; set `context.guardRows = [{ password_version, locked }]` to simulate lock/rotation state (see `test/room_lock.test.ts`).
- **HTTP tests** use Fastify's `app.inject()` (no live port). **WS tests** (`ws.test.ts`, `create_connection_ws.test.ts`) call `app.listen({ port: 0 })` and connect a real `ws` client, exercising the actual handshake/timeout/broadcast paths against the mocked DB.

## client (`web/client/test/`)

- **Config:** `web/client/vitest.config.ts` — jsdom, globals, `setupFiles: ['./test/setup.ts']`, same `@`/`shared` aliases as Vite, stubs for `__VERCEL_ENV__`/`__APP_VERSION__`/`__APP_COMMIT_SHA__`.
- **Setup** (`test/setup.ts`): `@testing-library/jest-dom`, auto-`cleanup()`, stubs `scrollIntoView` (jsdom gap), in-memory `localStorage` mock.
- **Patterns:** `@vue/test-utils` `mount` and/or `@testing-library/vue`; Pinia via `setActivePinia(createPinia())`; common `vi.mock`s for `@vercel/analytics`, `vue-router`, `../src/utils/api`, and stubbed `global.fetch`.
- **Coverage** (~50 files): store reducers (`test/stores/useRoomStore.test.ts`, sync/reset/ping), plot-route BFS (`PlotRoute.test.ts`), components (`RoomView`, `ReportForm`, `ZoneCombobox`, `RoomAuthView`, …), a large body of connection/handle/geometry tests (`ConnectionEdge`, `ConnectionPath*`, `ZoneNodeHandles`, `rotation`, `DisabledHandles`, …), and pure utils (`connectionStyle`, `treeQuery`, `formatters`).

## shared (`web/shared/test/`)

- Node env. Suites: `zonesAdapter.test.ts` (GameMap→Zone mapping), `zoneCategorization.test.ts` (exhaustive `getZoneCategory` coverage), `connections.test.ts` (cycle/loop detection), `rotation.test.ts` (rotation math + handle canonicalization).

## map-parser (`map-parser/test/`)

- `syncMaps.test.ts` — unit tests over the pure helpers **plus integration tests that shell out via `npx tsx` to the real `syncMaps.ts`**, using `--source` fixtures in a temp dir and `--output` to a temp file (network-free). Covers the classification truth table, exclusions, slugging, `--strict`, duplicate-id abort, and byte-identical deterministic output.
- `ZoneNameParser.test.ts` — shape/content/socket parsing.

## Conventions when adding tests

- Server: prefer `setupTestApp()`; mock query results in the exact order the handler issues them; if you touch broadcast behaviour, assert on the (mocked or real-WS) messages rather than internals.
- Client: drive components through props/user events, not internal state; remember countdowns depend on the injected `globalNow` ref.
- Anything touching zone data should use real ids from the catalogue (`ZONE_BY_ID`) so server-side zone validation passes.
- Analytics tests must compute "today" with `londonDateString()` (from `src/analytics.ts`), never `toISOString().slice(0, 10)` — the analytics buckets are Europe/London, and UTC dates diverge around midnight during BST.
- The README's per-package test counts drift out of date quickly — trust `pnpm test` output, not the README.
- map-parser has no typecheck in its test script; run `npx tsc --noEmit` in `map-parser/` when changing its types.
