title: [FEATURE]: GUI plugin extension point for timeline message actions
---
### Feature hasn't been suggested before.

- [x] I have verified this feature I'm about to request hasn't been suggested before.

### Describe the enhancement you want to request

GUI plugins can add panels, commands, slots and composer pills, but nothing per message in the timeline. The action row under a user message or assistant response (copy, revert, fork) is fixed.

I built "pin a Q&A turn" (#55195) in my fork: a pin button on the user message and the response, and a resizable panel that lists pinned turns and jumps back to them. The panel could be a GUI plugin, but the button can only be done by patching `session-ui`, so I have to rebase it on every release.

Proposal: a `MessageAction` registry, e.g.

```ts
ctx.add(MessageAction, {
  id: "pin",
  on: ["user", "assistant"],
  icon: () => (pinned(input.messageID) ? "pin-active" : "pin"),
  title: () => ctx.t("pin"),
  pressed: () => pinned(input.messageID),
  run: (input) => toggle(input.sessionID, input.messageID),
})
```

with `{ sessionID, messageID, role }` as input. A per-session store for the plugin to keep the pinned IDs would cover the rest. Happy to send a PR if the shape looks right.
