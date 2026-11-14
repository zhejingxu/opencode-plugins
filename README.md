# opencode-plugins

My OpenCode customizations, kept outside the OpenCode source tree so they survive upstream merges and can be set up
on a new machine in two commands.

| Part | Type | What it does |
| ---- | ---- | ------------ |
| [`packages/model-health`](packages/model-health) | server + TUI plugin | On-demand model availability probes (`model-health` RPC, `/health`, `/health-all`) |
| [`packages/adaptive-effort`](packages/adaptive-effort) | server plugin | Per-turn reasoning effort and cheaper sibling models for subagents/title/compaction |
| [`packages/tool-schema-guard`](packages/tool-schema-guard) | server plugin | Hotfix: keeps browser tools out of `explore` and drops `enum` on non-string tool schemas (Cloud Code / Gemini 400) |
| [`packages/auto-handoff`](packages/auto-handoff) | server plugin | Compacts large-window sessions at ~300k tokens (per-model policy from the live model list) and saves a handoff file before every compaction |
| [`patches/0001`](patches) | source patch | Desktop + TUI: compaction summaries collapsed by default |
| [`patches/0002`](patches) | source patch | Desktop: pin Q&A turns to a left-side panel |
| [`patches/0003`](patches) | source patch | Desktop: model health dots and "Check" in the model selector (uses `model-health`) |
| [`patches/0004`](patches) | source patch | Desktop: switch a subagent session's model from the subagent bar |
| [`patches/0005`](patches) | source patch | Browser plugin: keep browser tools out of child sessions (upstream PR #63691) |
| [`patches/0006`](patches) | source patch | Desktop: open new session tabs at the start of the tab strip (top when vertical) |

The plugins use only the public plugin API (`@opencode/plugin`, `@opencode/plugin/tui`). The patches touch the
Desktop/TUI timeline and model picker, which have no plugin extension point as of v2.2.5 (Desktop GUI plugins exist now, but offer no per-message actions, left region or reveal-message API); see [`issues/`](issues) for
the upstream requests that would let them become plugins too.

## New machine

```sh
git clone https://github.com/zhejingxu/opencode-plugins.git ~/Documents/ChatGPT/opencode-plugins
~/Documents/ChatGPT/opencode-plugins/scripts/install.sh            # symlinks plugins into ~/.config/opencode/plugins
# only if you run OpenCode from source and want the UI patches:
~/Documents/ChatGPT/opencode-plugins/scripts/apply-patches.sh ~/Documents/ChatGPT/opencode
```

## Merging upstream

```sh
cd ~/Documents/ChatGPT/opencode
git fetch origin
git switch local-features
git rebase origin/dev                      # resolve conflicts in the three feature commits only
~/Documents/ChatGPT/opencode-plugins/scripts/export-patches.sh . origin/dev local-features
```

Plugins need no rebase. `patches/BASE` records the upstream commit the patches were last exported from.

## Development

```sh
bun install
bun run typecheck
```

Plugins are loaded from source, so edits under `packages/*` hot-reload in a running OpenCode once installed.
