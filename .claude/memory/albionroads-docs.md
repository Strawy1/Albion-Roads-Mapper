---
name: albionroads-docs
description: docs/ folder is the architecture reference for this repo — read it before exploring from scratch
metadata: 
  node_type: memory
  type: project
  originSessionId: 13f760d6-3b0a-468f-9b88-b5234e3b6a26
---

The repo has a `docs/` folder (written 2026-07-17) covering the full architecture: `architecture.md` (overview + entry points), `server.md` (HTTP API + auth + background jobs), `websocket-protocol.md` (handshake + all message types + broadcast semantics), `database.md` (schema), `client.md` (Vue app + stores + Vue Flow canvas), `data-pipeline.md` (maps.json / map-parser), `testing.md`, `development.md`. `docs/README.md` is the index with a glossary (zone, chain, handle, room memory).

Read the relevant doc before re-exploring the codebase — and update the doc when changing the interfaces it describes. The root README is user-facing and drifts easily (test counts etc. were corrected 2026-07-18 but will drift again); the WS message unions in `web/shared/src/types.ts` are the true protocol source. Related: [[albionroads-dev-workflow]], [[albionroads-gotchas]].
