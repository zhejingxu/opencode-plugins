title: feat(session-ui,tui): collapse compaction summaries by default
---
Closes #48596

Compaction summaries are long and repeat on every compaction, which pushes the conversation out of view. This keeps them collapsed by default and opens them on click.

- Desktop/web: when the quiet divider (`experimental.background_compaction`) does not apply (manual, failed, or background compaction off), the record is one collapsible row: "Compacting" with the current section heading while it streams, then the outcome and token usage. Clicking opens the summary; the open state is kept with the other timeline disclosures. Failed and cancelled compactions still show their error. The quiet divider is unchanged.
- TUI: the compaction divider gets a `+`/`−` toggle and starts collapsed; clicking it opens the summary. Failures stay open.

Tests: updated the compaction cases in `timeline-stream.spec.ts`, `session-compaction.spec.ts` and the TUI Markdown lifecycle test; `session-ui` component tests (178) and unit tests pass.

### Visual

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="72" viewBox="0 0 240 72" fill="none">
  <style>
    .s{opacity:0;animation:o 4s ease-in-out infinite}
    .s2{animation-delay:.12s}.s3{animation-delay:.24s}
    .c{transform-origin:22px 18px;animation:r 4s ease-in-out infinite}
    @keyframes o{0%,35%{opacity:0}45%,85%{opacity:.35}95%,100%{opacity:0}}
    @keyframes r{0%,35%{transform:rotate(0)}45%,85%{transform:rotate(90deg)}95%,100%{transform:rotate(0)}}
    @media (prefers-reduced-motion:reduce){.s,.c{animation:none}}
  </style>
  <g stroke="currentColor" stroke-linecap="round">
    <rect x="12" y="10" width="16" height="16" rx="3" opacity=".5"/>
    <path class="c" d="M20 15l4 3-4 3" stroke-width="1.5"/>
    <path d="M36 18h70" stroke-width="5" opacity=".55"/>
    <path d="M114 18h46" stroke-width="5" opacity=".25"/>
  </g>
  <g fill="currentColor">
    <rect class="s" x="36" y="34" width="150" height="4" rx="2"/>
    <rect class="s s2" x="36" y="44" width="180" height="4" rx="2"/>
    <rect class="s s3" x="36" y="54" width="120" height="4" rx="2"/>
  </g>
</svg>
```
