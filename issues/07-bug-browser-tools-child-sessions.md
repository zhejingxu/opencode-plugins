title: Browser tools leak into child sessions, so explore gets every browser tool
---
### Description

When the desktop browser is attached to a session, subagents started from that session are sent all ~45 browser tools, including the read-only `explore` agent.

The grant is written to the parent's `session.permissions` (`browser: allow`). `Session.create` copies the parent's permissions to children, and session rules are merged after the agent's rules, so the allow beats `explore`'s `* deny`. `explore` has no Code Mode (`execute` is denied), so `Tool.snapshot` sends the browser tools as direct tools.

None of them can work in the child: `BrowserConnection.target` looks up the attachment by the child's session ID, which never has one, so every call returns `[browser.disconnected]`. The grant also stays on the child after the parent detaches, because the revoke only rewrites the attached session.

I noticed it because the extra schemas broke the subagent entirely: `browser_click.count` is `{ "type": "number", "enum": [1, 2] }`, which the gateway I use rejects with `400 ... does not accept JSON Schema keyword(s): enum`. The main session was fine since there the browser tools are inside `execute`.

### Plugins

None (built-in desktop browser)

### OpenCode version

2.2.5 (`dev` @ fb11429446)

### Steps to reproduce

1. Open a session in the desktop app and let the browser attach.
2. Ask the agent to start an `explore` subagent.
3. Look at the child's request: it lists all `browser_*` tools; calling one returns `[browser.disconnected]`.

### Operating System

macOS 26.5.1

### Terminal

Desktop app
