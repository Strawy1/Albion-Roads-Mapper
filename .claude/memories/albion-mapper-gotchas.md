---
name: albion-mapper-gotchas
description: "albion-mapper invariants and known drift that will bite changes (server-owned positions, full-array broadcasts, duplicate GameMap defs)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 13f760d6-3b0a-468f-9b88-b5234e3b6a26
---

Invariants and drift observed 2026-07-17 (verify still true before relying on them):

**Why:** these are the traps a change is most likely to fall into; some are documented only in code comments.

**How to apply:**
- Node positions are **server-authoritative**; most mutations broadcast the *entire* `room_node_positions` array (`node_positions_updated`) re-read from DB. Exceptions sending a single row: `POST /chains` and `rotate_zone`. Don't reintroduce client-side position persistence — the DELETE+reinsert clobbering footgun is documented in comments in `web/client/src/views/RoomView.vue`.
- Positions are updated via delete+reinsert preserving `chain_id`; a new column on `room_node_positions` must be carried through every reinsert path (`update_node_positions`, import, chain relocate).
- Client-side connection validation is UX only; the server re-validates (zone existence in `ZONE_BY_ID`, chain membership, no cross-chain links, handle occupancy, disabled handles). Add rules in both places.
- Rotation (0–3 steps) and `customHandles` can desync; both sides self-heal by inferring rotation from handles — **handles win**. Shared helpers in `web/shared/src/rotation.ts`.
- Broadcast exclusion trap (bit us 2026-07-18, hideout portal save): `update_node_positions` broadcasts EXCLUDE the sender (optimistic-update echo suppression), `rotate_zone` broadcasts INCLUDE the sender (authoritative reapply). A client flow must never split one logical edit across both messages — the rotate echo will carry stale DB state back to the sender while the real update never reaches them. The ZoneHandleEditor save therefore sends ONE `rotate_zone { zoneId, rotation, customHandles }`; regression tests: `web/server/test/hideout_portal_save.test.ts`, `web/client/test/HideoutPortalLiveUpdate.test.ts`.
- JWTs embed `passwordVersion`; password rotation invalidates all tokens. WS close code **4401 = don't reconnect** (client redirects to auth); other closes trigger backoff reconnect.
- `GameMap` is owned by shared; `map-parser/src/types.ts` re-exports it and keeps only `GameMapSchema` (`z.ZodType<GameMap>`). New `GameMap` fields must be added to BOTH the shared interface and the schema — sync/migrate write Zod-parsed output, so schema-missing fields are silently stripped from `maps.json` (drift fixed 2026-07-18).
- Analytics date buckets are Europe/London (`londonDateString()`); tests computing "today" via UTC `toISOString()` fail around midnight during BST — always use `londonDateString()`.
- map-parser has no typecheck step (`tsx` elides types); run `npx tsc --noEmit` in `map-parser/` after type changes.

Related: [[albion-mapper-docs]], [[albion-mapper-dev-workflow]].
