# adaptive-effort

Server plugin that keeps the main session on the flagship model while saving cost elsewhere:

- **Main turns**: picks `reasoningEffort` (`low` / `medium` / `high`) from the user's message. Debugging, root-cause,
  architecture and long prompts get `high`; UI tweaks and short follow-ups get `medium`. Force a tier with `#high`,
  `#medium`, `#low` (or `[high]` …). "继续 / continue" keeps the previous tier; two or more failed tool calls in a turn
  raise it to `high`.
- **Subagents, title, compaction, generate**: routes the request to a cheaper sibling on the same provider
  (Claude Opus/Fable → Sonnet 5.5 / 5, `*-high` → `*-medium`/`*-low`, GPT-6 Sol/Astra → Luna for explore/title) by
  rewriting the outgoing request body in the `http.request` hook. Only models that exist on that provider are used.
- An explicit model variant chosen by the user always wins.

`reasoningEffort` is only set for providers `gateway` and `relay` and for model IDs known to accept it; edit
`supportsEffortOption` in `index.ts` for other setups.
