#!/usr/bin/env bash
# Links the server/TUI plugins in this repository into the global OpenCode plugin directory.
# Re-running is safe: existing links are replaced, regular files are backed up first.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
target="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}/plugins"
mkdir -p "$target"

link() {
  local source="$1" name="$2" dest="$target/$2"
  if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    mv "$dest" "$dest.backup-$(date +%Y%m%d-%H%M%S)"
    echo "backed up existing $dest"
  fi
  ln -sfn "$source" "$dest"
  echo "linked $dest -> $source"
}

link "$repo/packages/model-health" "model-health"

# adaptive-effort used to live as a single file; replace it with the directory plugin.
if [ -f "$target/adaptive-effort.ts" ] && [ ! -L "$target/adaptive-effort.ts" ]; then
  mv "$target/adaptive-effort.ts" "$target/adaptive-effort.ts.backup-$(date +%Y%m%d-%H%M%S)"
  echo "backed up legacy $target/adaptive-effort.ts"
fi
link "$repo/packages/adaptive-effort" "adaptive-effort"
link "$repo/packages/tool-schema-guard" "tool-schema-guard"

echo "Done. OpenCode reloads plugin directories automatically; restart it if the plugins do not appear."
