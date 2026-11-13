# Upstream issues and comments (anomalyco/opencode)

| # | Kind | Status | File |
| - | ---- | ------ | ---- |
| 1 | feature request: GUI plugin message actions + reveal | filed as #61385 | `01-gui-message-actions.md` |
| 2 | feature request: structured `generate.text` failure reason | **dropped**: upstream `dev` already returns `ProviderRequestError { reason, status }` | `02-generate-error-reason.md` |
| 3 | comment on #48596 (collapsible compaction summary) | posted | `03-comment-48596.md` |
| 4 | comment on #55195 (pin messages) | posted | `04-comment-55195.md` |
| 5 | PR: collapse compaction summaries by default | waiting for maintainer OK on #48596; see also draft PR #58162 | `05-pr-collapse-compaction.md`, `../upstream/collapse-compaction.patch` |
| 6 | bug report: compaction hangs on "Compacting" | filed as #61346 (`reproduced`); keepalive fix tracked in PR #52866 | `06-bug-compaction-hang.md` |
| 7 | bug report: browser tools leak into child sessions (explore) | filed as #63690 | `07-bug-browser-tools-child-sessions.md` |
| 8 | PR: keep browser tools out of child sessions | opened as #63691 (`Closes #63690`); local copy `patches/0005` | `08-pr-browser-child-tools.md` |

Upstream asks for the issue templates and short, human-written text; long AI-style issues are auto-flagged.
