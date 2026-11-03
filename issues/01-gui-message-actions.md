title: [FEATURE]: Let GUI plugins add per-message actions and reveal a message in the timeline
---
### Feature hasn't been suggested before.

- [x] I have verified this feature I'm about to request hasn't been suggested before.

### Describe the enhancement you want to request

GUI plugins can add commands, panels, slots and composer pills, but nothing on an individual message. The action row under a user message or an assistant response (copy, revert, fork) is fixed, and a plugin can't scroll the timeline to a given message.

That is what blocks #55195 (pin messages) from being a plugin, as the bot noted there. I built pinning in my fork: a pin button on the user message and on the response, plus a panel that lists pinned turns and jumps back to them. The panel itself would fit the current plugin API, but the button and the jump need a patch to `session-ui` and `app`, which I have to rebase on every release.

Proposal:

```ts
ctx.add(MessageAction, {
  id: "pin",
  on: ["user", "assistant"],
  icon: (input) => (pinned(input.messageID) ? "pin-active" : "pin"),
  title: () => ctx.t("pin"),
  pressed: (input) => pinned(input.messageID),
  run: (input) => toggle(input.sessionID, input.messageID),
})

ctx.sessions.reveal({ sessionID, messageID })
```

with `{ sessionID, messageID, role }` as the action input. A per-session store (already available through `stores`) covers the rest.

Patch for reference: https://github.com/zhejingxu/opencode-plugins/blob/main/patches/0002-feat-app-pin-Q-A-turns-to-a-left-side-panel.patch
