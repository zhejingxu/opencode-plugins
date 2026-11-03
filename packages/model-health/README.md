# model-health

On-demand availability checks for configured OpenCode models.

- **Server** (`server.ts`): registers the `model-health` RPC. `check({ providerID, modelID, force? })` sends one
  tiny stateless request through `ctx.generate.text`, classifies failures (`not_found`, `authentication`,
  `rate_limit`, `quota`, `timeout`, `network`, `provider`, …) and caches the result. Concurrent checks of one model
  share a request. Nothing runs in the background.
- **TUI** (`tui.ts`): `/health` checks the current model, `/health-all` checks every model and lists the results;
  selecting an entry re-checks it. Both are also in the command palette.
- **Desktop / web**: the model selector dots and "Check" button come from
  `patches/0003-*.patch`, which calls this RPC. Without the plugin the patched UI hides the check controls.
- **Contract** (`rpc.ts`): schemas only, safe for clients to import.

Each check costs one small model request.

## Options

```jsonc
{
  "plugins": [{ "package": "/abs/path/to/model-health", "options": { "ttlMs": 60000, "timeoutMs": 15000, "prompt": "Reply with OK." } }]
}
```

## Install

```sh
# local checkout (hot-reloads on edit)
scripts/install.sh
# or from Git
opencode plugin add 'git+https://github.com/<you>/opencode-plugins.git#path:packages/model-health'
```
