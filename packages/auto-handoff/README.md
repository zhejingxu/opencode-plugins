# auto-handoff

Server plugin that keeps long sessions fast without losing what mattered.

## What it does

1. **Per-model compaction threshold.** On every model whose usable window (`min(limit.input, limit.context)`) is large
   enough, the session is compacted once its prompt reaches `target` tokens (300k by default). Smaller windows keep
   OpenCode's built-in trigger (85% of the window, at least 16k free). Thresholds come from the live model list, so
   models added later are covered without config changes. The current table is written to
   `<dir>/_compaction-policy.md`.
2. **Handoff file before every compaction** (plugin-triggered, OpenCode's automatic one, or `/compact`):
   - before the summary: the user's original requests (verbatim), links, changed files, git operations and the last
     reply are extracted from the transcript and appended to `<dir>/<date>_<title>_<sessionID>.md`;
   - the summary request is asked to end with a verbatim `## Key facts ledger` (branches, commits, IDs, links,
     conclusions, TODOs, blockers);
   - after compaction the summary is appended to the same file, and the file path is pinned into the session's
     instructions so the agent reads it when it needs early details.

Don't also set a global `compaction.buffer` in `opencode.json`: a token buffer behaves differently on models with an
input limit (e.g. 922k input → compacts at ~222k with `buffer: 700000`).

## Options

```jsonc
{
  "plugins": [
    { "package": "~/.config/opencode/plugins/auto-handoff", "options": { "target": 300000, "dir": "~/Documents/Codex/handoffs" } }
  ]
}
```

Without options it is picked up from `~/.config/opencode/plugins/auto-handoff` (see `scripts/install.sh`) with the
defaults above.

## Backfill

For sessions compacted before the plugin was installed, rebuild the handoff file from the local database (read-only)
and pin it through the running service:

```sh
bun packages/auto-handoff/backfill.ts ses_xxx [ses_yyy ...]
```

## Development

```sh
bun test packages/auto-handoff
bun run typecheck
```
