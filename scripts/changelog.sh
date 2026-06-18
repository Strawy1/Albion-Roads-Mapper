#!/bin/bash
#
# Interactively generate a changelog section (via git-cliff) covering every
# commit from a starting SHA up to HEAD, and prepend it to CHANGELOG.md.
#
# Usage: scripts/changelog.sh [from-sha]
# If from-sha is omitted, you'll be prompted for it.

set -euo pipefail
cd "$(dirname "$0")/.."

FROM_SHA="${1:-}"

if [ -z "$FROM_SHA" ]; then
  echo "This generates a changelog section covering every commit from a starting"
  echo "point up to HEAD ($(git rev-parse --short HEAD) - $(git log -1 --pretty=%s))."
  echo
  read -rp "Starting commit SHA: " FROM_SHA
fi

if [ -z "$FROM_SHA" ]; then
  echo "Error: no SHA entered." >&2
  exit 1
fi

if ! git rev-parse --verify "${FROM_SHA}^{commit}" &>/dev/null; then
  echo "Error: '$FROM_SHA' is not a valid commit SHA in this repo." >&2
  exit 1
fi

RANGE="${FROM_SHA}..HEAD"
COMMIT_COUNT="$(git rev-list --count "$RANGE")"

if [ "$COMMIT_COUNT" -eq 0 ]; then
  echo "Error: there are no commits between $FROM_SHA and HEAD." >&2
  exit 1
fi

echo
echo "Found ${COMMIT_COUNT} commit(s) between $(git rev-parse --short "$FROM_SHA") and HEAD:"
echo
git log "$RANGE" --oneline --no-merges
echo

CURRENT_VERSION="$(jq -r '.version' package.json)"
read -rp "Version/tag for this entry (e.g. ${CURRENT_VERSION}), or leave blank for an 'Unreleased' section: " VERSION

read -rp "Prepend this to CHANGELOG.md? [Y/n] " CONFIRM
if [[ "$CONFIRM" =~ ^[Nn]$ ]]; then
  echo "Aborted."
  exit 0
fi

if [ -n "$VERSION" ]; then
  pnpm exec git-cliff "$RANGE" --tag "$VERSION" --prepend CHANGELOG.md
else
  pnpm exec git-cliff "$RANGE" --unreleased --prepend CHANGELOG.md
fi

echo
echo "Done. CHANGELOG.md updated."
