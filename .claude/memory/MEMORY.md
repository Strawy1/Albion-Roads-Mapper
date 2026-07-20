# Memory Index

- [Docs folder is the architecture reference](albion-mapper-docs.md) — read docs/ before re-exploring; update it when changing interfaces; root README drifts
- [Dev workflow](albion-mapper-dev-workflow.md) — build/run/test commands; shared isn't watched by pnpm dev; server tests mock pg.Pool entirely and run serially
- [Gotchas & invariants](albion-mapper-gotchas.md) — server-owned positions, full-array WS broadcasts, sender-exclusion trap on split edits, delete+reinsert paths, handles-win rotation healing, room-lock chokepoint + guard-SQL test dispatch, known schema drift
- [Metrics conventions](albion-mapper-metrics-conventions.md) — /metrics output grouped by topic sections; live-state gauges over day buckets; counters for monotonic totals; global/per-room naming pairs

Note: this memory lives in the repo at `.claude/memory/` (wired via `autoMemoryDirectory` in `.claude/settings.json`) so it's shared via git across machines and collaborators.
