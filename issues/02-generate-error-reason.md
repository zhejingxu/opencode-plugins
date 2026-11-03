title: [FEATURE]: Structured failure reason from plugin generate.text
---
### Feature hasn't been suggested before.

- [x] I have verified this feature I'm about to request hasn't been suggested before.

### Describe the enhancement you want to request

I wrote a plugin that checks whether a configured model actually works: it sends one tiny `ctx.generate.text({ model })` request on demand, caches the result for 60s and shows a green/red dot in the model picker and a `/health` command in the TUI. It is useful with several gateways and relays, where a model is listed but the key, quota or route is broken.

`Generate.UnavailableError` flattens the `AIError` into a message string, so the plugin has to guess the cause with regexes (401, 429, quota, timeout…).

Proposal: keep the `AIError` reason on the error, e.g. `UnavailableError { message, service, reason?: "authentication" | "rate_limit" | "quota" | "provider" | "timeout" | "transport" | ... }`, and optionally accept `maxTokens` / an abort signal in `generate.text` so probes stay cheap and bounded.

Plugin for reference: <link to opencode-plugins/packages/model-health once pushed>
