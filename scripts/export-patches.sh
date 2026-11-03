#!/usr/bin/env bash
# Regenerates patches/ from the local feature branch of an OpenCode checkout.
# Usage: scripts/export-patches.sh <opencode-checkout> <base-ref> [branch-name]
# Example: scripts/export-patches.sh ~/Documents/ChatGPT/opencode origin/dev local-features
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
checkout="${1:?usage: export-patches.sh <opencode-checkout> <base-ref> [branch-name]}"
base="${2:?missing base ref, e.g. origin/dev}"
branch="${3:-local-features}"

rm -f "$repo"/patches/*.patch
git -C "$checkout" format-patch "$base..$branch" -o "$repo/patches" >/dev/null
echo "base: $(git -C "$checkout" rev-parse "$base")" > "$repo/patches/BASE"
ls "$repo"/patches
