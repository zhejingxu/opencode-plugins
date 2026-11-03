#!/usr/bin/env bash
# Applies the UI patches that cannot be expressed as plugins yet onto an OpenCode checkout.
# Usage: scripts/apply-patches.sh <opencode-checkout> [branch-name]
# Creates <branch-name> (default: local-features) from the checkout's current HEAD and
# applies patches/*.patch with a 3-way merge so upstream drift surfaces as normal conflicts.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
checkout="${1:?usage: apply-patches.sh <opencode-checkout> [branch-name]}"
branch="${2:-local-features}"

cd "$checkout"
if [ -n "$(git status --porcelain)" ]; then
  echo "error: $checkout has uncommitted changes; commit or stash them first" >&2
  exit 1
fi

git switch -c "$branch"
if ! git am --3way "$repo"/patches/*.patch; then
  echo
  echo "A patch did not apply cleanly. Resolve the conflict, then run 'git am --continue'"
  echo "(or 'git am --abort' to give up). Afterwards refresh the patches with:"
  echo "  $repo/scripts/export-patches.sh $checkout <base-ref>"
  exit 1
fi
echo "Applied $(ls "$repo"/patches/*.patch | wc -l | tr -d ' ') patches on branch $branch"
