---
name: albionroads-deploy-pipeline-rollout
description: "Backend auto-deploy: live and validated end to end since 2026-07-27, plus the infra facts that live outside the repo"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5dbf94b8-d4a5-4973-af39-e8970179de69
  modified: 2026-07-27T03:39:49.193Z
---

Since 2026-07-27 the backend deploys itself — no local `build-docker.sh`, no manual SSH. Validated end to end that day: two `Backend Deployment` runs on `main` (PRs #7 and #9) published and deployed cleanly. Mechanics are in `docs/development.md` ("Backend CI/CD") — see [[albionroads-docs]]. Shipped as dignityofwar/albionroads#8 (demo video → YouTube), #7 (the pipeline), Maelstromeous/webhooks#4 (the hook).

**The parts that aren't in this repo:**
- `WEBHOOK_URL` is a repo secret holding the deploy hook's endpoint on Mael's webhooks host, reached over a Cloudflare Zero Trust tunnel (no `cloudflared` on the box). **This repo is public — do not write the endpoint or the host's LAN address down here;** they live in the private `Maelstromeous/webhooks` repo, which is also the full runbook. The hook is chosen by **URL path**; the JSON body is decorative, existing only to give the HMAC something to sign. One `WEBHOOK_SECRET` is shared by every project on that host.
- The target box's compose file is `/root/docker/docker-compose.yml` and the hook runs `/root/update.sh` there. Its LAN address is in the private webhooks repo's inventory, not here.
- Both Docker Hub PATs were rotated on 2026-07-27 (the old one was lost); `dignityofwar/diglet-bot` shares the same account.

**Loose ends from that session:**
- `maelstromeous/applications:digletbot-credential-test` is a junk 3.7MB alpine tag pushed to prove the rotated PAT — delete it.
- The server's compose still carried a dead `MEDIA_PATH: /app/media` as of 27 Jul; harmless, but the image no longer has that directory.
- **Unverified:** whether `/root/update.sh` does `pull && up -d` or a wholesale `down && up`. Both channels share one hook, so if it's the latter, every *testing* deploy briefly drops production. Worth reading before trusting the testing channel.

**How to apply:** if a deploy goes green but nothing changes on the box, suspect the server's compose image tag first — `dig-roadmap` was this project's original name and that tag lived in the shared `maelstromeous/applications` repo, not today's dedicated `maelstromeous/albionroads` one.
