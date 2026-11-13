title: fix(plugin-browser): keep browser tools out of child sessions
---
### Issue for this PR

Closes #61238

### Type of change

- [x] Bug fix
- [ ] New feature
- [ ] Refactor / code improvement
- [ ] Documentation

### What does this PR do?

Child sessions inherit the parent's `browser: allow` rule, but the attachment is keyed by the parent's session ID, so browser calls from a child always return `[browser.disconnected]`. Agents without Code Mode, like `explore`, still got all browser tools as direct tools.

The browser plugin now registers a `session` `context` hook that drops its direct tools when the requesting session has no attachment (connecting or connected). Attached sessions are unchanged. I kept it in the plugin instead of changing how children inherit permissions, since that inheritance is intentional for other host rules.

Tools reached through `execute` are not filtered here; they still return the existing disconnected error.

#63002 also stops grants leaking to subagents as part of a much larger browser change. This is a small standalone fix for #61238 in the meantime; feel free to close it if #63002 lands first.

### How did you verify your code works?

- New test in `packages/core/test/browser-attach.test.ts`: after attaching, a child created with `parentID` still inherits the grant, but its context request keeps only non-browser tools while the parent keeps them all. It fails without the change.
- `bun test` in `packages/plugin-browser`, `browser-attach`/`tool-registry`/`session-model-request` tests in `packages/core`, and `bun typecheck` in both packages pass.

### Checklist

- [x] I have tested my changes locally
- [x] I have not included unrelated changes in this PR
