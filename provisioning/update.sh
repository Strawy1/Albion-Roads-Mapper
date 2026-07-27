#!/usr/bin/env bash
#
# Runs ON THE SERVER (albionroads, 10.0.5.10) as /root/update.sh. The webhooks
# box SSHes in and executes it; it is the last step of the deploy chain:
#
#   merge to main -> Backend Deployment -> Docker Hub -> webhook -> here
#
# This file is the source of truth, but NOTHING SYNCS IT. When it changes:
#
#   scp provisioning/update.sh root@albionroads.public.lan:/root/update.sh
#   ssh root@albionroads.public.lan 'chmod 755 /root/update.sh'
#
# This script is the ONLY place in the chain that can detect a failed deploy.
# The webhook returns 200 before the SSH even happens and does not report the
# remote exit code, so if this script does not write a failure down, nothing
# anywhere does.
#
# It replaces a version that could — and on 2026-07-27 did — report success
# while deploying nothing. See "the && trap" below.
#
set -euo pipefail

LOG=/root/deploy.log
COMPOSE_DIR=/root/docker
SERVICES=(server server-testing)
LOCK=/var/lock/albionroads-deploy.lock
LOCK_WAIT=600

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG"; }

fail() {
  local code=$?
  log "DEPLOY FAILED (exit $code) at line $1."
  log "  Services may be stopped. Check: docker compose -f $COMPOSE_DIR/docker-compose.yml ps"
  exit "$code"
}
trap 'fail $LINENO' ERR

# THE && TRAP, and why every command below is on its own line.
#
# The old script did:
#     docker compose pull server && docker compose down server && docker compose up server -d
#
# `set -e` does NOT apply to a command on the left of `&&` — only to the last
# command in the list. So a failed pull skipped `down` and `up`, did not exit,
# and fell straight through to `echo "Container updated!"`. The deploy reported
# success, the hook returned 200, and nothing was deployed. That is exactly what
# happened when the Docker Hub repo was renamed out from under this box: the
# pull failed, the log said "Container updated!" three seconds later, and the
# containers were still the ones started thirteen hours earlier.
#
#     bash -c 'set -euo pipefail; false && echo B; echo "still here"'  # prints: still here
#
# Never collapse these back into an && chain.

exec 9>"$LOCK"
if ! flock -w "$LOCK_WAIT" 9; then
  log "Another deploy has held the lock for ${LOCK_WAIT}s — giving up rather than racing it."
  exit 1
fi

cd "$COMPOSE_DIR" || { log "FATAL: $COMPOSE_DIR does not exist."; exit 1; }

log "Deploy requested."

declare -A before
for s in "${SERVICES[@]}"; do
  before[$s]=$(docker compose images -q "$s" 2>/dev/null || true)
done

# --quiet drops the per-layer progress bars, which otherwise bury deploy.log.
# Errors still print, and still land in the log via tee.
log "Pulling images..."
docker compose pull --quiet "${SERVICES[@]}" 2>&1 | tee -a "$LOG"

# `up -d` recreates a container only when its image digest actually changed, so
# a no-op deploy costs about a second and drops nothing. The old `down` + `up`
# tore both containers down on EVERY call — measured on this box: two deploys of
# the same commit, identical image ID, and StartedAt still moved.
#
# --wait blocks until each healthcheck passes, turning "container started" into
# "container actually serving". Both services are brought up in one call so a
# failure in either fails the deploy.
log "Recreating any service whose image changed..."
docker compose up -d --wait "${SERVICES[@]}" 2>&1 | tee -a "$LOG"

changed=0
for s in "${SERVICES[@]}"; do
  after=$(docker compose images -q "$s" 2>/dev/null || true)
  if [ -z "$after" ]; then
    log "DEPLOY FAILED: no image recorded for $s after up — is the service name right?"
    exit 1
  fi
  if [ "${before[$s]}" = "$after" ]; then
    log "  $s: unchanged (${after:0:12})"
  else
    prev=${before[$s]:0:12}
    [ -n "$prev" ] || prev='(none)'
    log "  $s: updated $prev -> ${after:0:12}"
    changed=1
  fi
  # Surfaces a compose file with no healthcheck, where --wait silently degrades
  # to "is it running" and most of the guarantee above is gone.
  health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}NO HEALTHCHECK — --wait only checked it is running{{end}}' "$s" 2>/dev/null || echo 'unknown (container not found)')
  log "  $s: $health"
done

if [ "$changed" -eq 0 ]; then
  log "Nothing to deploy — no image digest changed."
  log "  If you expected a change, this box may be pulling a different tag from the one CI pushes."
fi

# Each pull of a moving tag orphans the previous image. Dangling-only and older
# than a week, so tagged images (including albionroads:<sha> rollback targets and
# anything belonging to other stacks) are never touched. Best-effort: tidying up
# must not fail a deploy that already worked.
docker image prune -f --filter 'until=168h' >/dev/null 2>&1 || true

log "Deployment finished!"
