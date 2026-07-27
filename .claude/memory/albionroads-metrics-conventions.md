---
name: albionroads-metrics-conventions
description: /metrics output must keep similarly-named metrics grouped by topic; other conventions Matt has set for the metrics endpoint
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 984f09cd-530b-461b-8af2-8171667060d5
  modified: 2026-07-18T20:12:50.561Z
---

Conventions for `web/server/src/routes/metrics.ts` (`GET /metrics`):

- **Group by topic.** The output is organized into `// === Topic ===` sections (Rooms, Connections, Zones, Chains, Routes, Tokens, Data updates, Admin actions, Map History). When adding a metric, place it inside the matching section — never append at the end or next to whatever query produced it. Matt explicitly asked for similarly-named metrics to be physically adjacent in the exposition output.
- **Prefer live-state gauges over analytics day buckets** for "how many X right now" (e.g. rooms with a plotted route reads `rooms.plotted_route`, not `analytics_*_daily`) — Prometheus scraping provides the time dimension.
- **Monotonic all-time totals are exposed as `counter` type** (e.g. `albionmapper_routes_plotted_total`), not gauge, so `increase()`/`rate()` work.
- Naming pairs: global scalar + per-room labeled companion (`albionmapper_rooms_locked` / `albionmapper_room_locked{room_id}`).
- Default-feature exclusion pattern: per-room feature gauges omit rooms that only have the seeded default (home zone excluded from zone counts; primary chain excluded so single-chain rooms don't appear as "using chains").

**Why:** Matt reads the raw /metrics page and wants related series findable in one place; scattered route metrics prompted the reorganization (2026-07-18).

**How to apply:** When touching metrics.ts, keep queries in the query block and emission in the topic sections; add new metrics to their topic group and follow the existing type/naming patterns. See also [[albionroads-gotchas]].
