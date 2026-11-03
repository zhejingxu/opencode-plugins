# Upstream issue drafts (anomalyco/opencode)

Searched on 2026-11-03 before drafting. Upstream asks for the Feature Request template and short,
human-written text (long AI-style issues are auto-flagged), so keep these brief and edit them in your own words.

| # | Kind | Target | File |
| - | ---- | ------ | ---- |
| 1 | new issue | GUI plugin extension point for timeline message actions | `01-gui-message-actions.md` |
| 2 | new issue | structured failure reason for plugin `generate.text` | `02-generate-error-reason.md` |
| 3 | comment | #48596 Make Compaction Summary Collapsible by Default | `03-comment-48596.md` |
| 4 | comment | #55195 Pin messages and selected text in the Desktop chat | `04-comment-55195.md` |
| 5 | PR (after a maintainer OKs #48596) | branch `collapse-compaction` on origin/dev | `05-pr-collapse-compaction.md` |

Related, already filed, no action needed: #56037 / #57619 (third-party GUI extensions), #61187 (code-block actions).

Filing with GitHub CLI once logged in (`gh auth login`):

```sh
gh issue create -R anomalyco/opencode --title "$(sed -n 's/^title: //p' issues/01-gui-message-actions.md)" --body-file <(sed '1,/^---$/d' issues/01-gui-message-actions.md)
gh issue comment 48596 -R anomalyco/opencode --body-file issues/03-comment-48596.md
```
