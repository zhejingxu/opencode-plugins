/** Pure helpers for auto-handoff: per-model compaction thresholds and the pre-compaction ledger. */

export const DEFAULT_TARGET = 300_000

// Mirrors packages/core/src/session/compaction.ts so the policy table shows what the built-in trigger does.
const RESERVE_MIN = 16_000
const RESERVE_SHARE = 0.15

export interface Limit {
  readonly context?: number
  readonly input?: number
  readonly output?: number
}

/** The largest prompt the model takes: the input limit when set, capped by the context window. */
export function windowOf(limit: Limit) {
  const { context = 0, input = 0 } = limit
  return input && context ? Math.min(input, context) : input || context
}

/** Where OpenCode's own automatic compaction starts with the default buffer. */
export function builtinTrigger(window: number) {
  if (window <= 0) return Number.POSITIVE_INFINITY
  return window - Math.max(Math.floor(window * RESERVE_SHARE), window >= 2 * RESERVE_MIN ? RESERVE_MIN : 0)
}

export interface Plan {
  readonly window: number
  readonly trigger: number
  /** `plugin` when auto-handoff compacts earlier than the built-in trigger. */
  readonly by: "plugin" | "builtin"
}

/** Compact at `target` tokens, or at the built-in trigger when the window is too small for that. */
export function planFor(limit: Limit, target = DEFAULT_TARGET): Plan {
  const window = windowOf(limit)
  const builtin = builtinTrigger(window)
  if (window > 0 && target < builtin) return { window, trigger: target, by: "plugin" }
  return { window, trigger: builtin, by: "builtin" }
}

export interface Usage {
  readonly input?: number
  readonly output?: number
  readonly cache?: { readonly read?: number; readonly write?: number }
}

/** Tokens the next request will carry: this prompt plus the reply appended to it. */
export function promptTokens(tokens: Usage | undefined) {
  if (!tokens) return 0
  return (tokens.input ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0) + (tokens.output ?? 0)
}

export const SUMMARY_INSTRUCTION = [
  "Harness formatting rule for this summary (not a user requirement; do not list it under requirements or in the ledger):",
  "in addition to the normal summary, end it with a section titled `## Key facts ledger`.",
  "List, verbatim and without paraphrasing identifiers:",
  "- Every explicit user requirement, preference or constraint still in force.",
  "- Repositories, branches, commits, MRs, builds, deployments, lanes/environments and their current state.",
  "- Concrete IDs: PSMs, topics, clusters, services, room/session/task IDs, ticket and approval links with status.",
  "- Files created or changed, and where results, reports or specs were saved.",
  "- Confirmed conclusions and root causes, separately from open hypotheses.",
  "- Open TODOs, blockers, and what the user still has to do (logins, approvals).",
  "Write the ledger in the user's language. Omit a bullet only when there is nothing for it.",
].join("\n")

interface Part {
  readonly type: string
  readonly text?: string | null
  readonly name?: string
  readonly input?: unknown
}

export interface LedgerMessage {
  readonly role: string
  readonly content: ReadonlyArray<Part> | string
}

export interface Ledger {
  readonly requests: string[]
  readonly urls: string[]
  readonly files: string[]
  readonly git: string[]
  readonly lastReply?: string
}

const SYNTHETIC_PREFIXES = [
  "Instructions from: ",
  "<system-update>",
  "<conversation-checkpoint>",
  "<shell ",
  "The server restarted while you were working.",
]

const URL_RE = /https?:\/\/[^\s"'`<>)\]}，。；、]+/g
const GIT_RE =
  /\bgit\s+(?:-C\s+\S+\s+)?(?:commit|push|checkout\s+-b|switch\s+-c|merge|rebase|cherry-pick|tag|worktree\s+add)\b/
const FILE_TOOLS = new Set(["write", "edit", "apply_patch", "multiedit"])

function parts(message: LedgerMessage): ReadonlyArray<Part> {
  return typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content
}

function texts(message: LedgerMessage) {
  return parts(message)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim()
}

function cleanUserText(raw: string) {
  return raw
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, " ")
    .replace(/^You are a subagent spawned by another session\.\s*/i, "")
    .trim()
}

function clip(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, max)}…（已截断，原文 ${text.length} 字）`
}

function addUnique(list: string[], seen: Set<string>, value: string) {
  if (!value || seen.has(value)) return
  seen.add(value)
  list.push(value)
}

function urlsIn(text: string, list: string[], seen: Set<string>) {
  for (const match of text.matchAll(URL_RE)) addUnique(list, seen, match[0].replace(/[.,:;!?]+$/, ""))
}

function inputRecord(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object") return input as Record<string, unknown>
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input)
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>
    } catch {}
  }
  return {}
}

/** Keeps the first `head` items (the original task usually comes first) and the most recent rest, marking the gap. */
export function keepEnds(items: string[], max: number, head: number) {
  if (items.length <= max) return items
  const tail = max - head
  return [...items.slice(0, head), `…（中间省略 ${items.length - max} 条，完整记录见会话历史）`, ...items.slice(-tail)]
}

/** Facts a summary tends to lose, read straight from the transcript before it is compacted. */
export function extractLedger(messages: ReadonlyArray<LedgerMessage>): Ledger {
  const requests: string[] = []
  const urls: string[] = []
  const files: string[] = []
  const git: string[] = []
  const seenUrl = new Set<string>()
  const seenFile = new Set<string>()
  const seenGit = new Set<string>()
  let lastReply: string | undefined

  for (const message of messages) {
    if (message.role === "user") {
      const text = texts(message)
      if (!text || SYNTHETIC_PREFIXES.some((prefix) => text.startsWith(prefix))) continue
      const cleaned = cleanUserText(text)
      if (!cleaned) continue
      requests.push(clip(cleaned, 2_000))
      urlsIn(cleaned, urls, seenUrl)
      continue
    }
    if (message.role !== "assistant") continue
    const reply = texts(message)
    if (reply) {
      lastReply = reply
      urlsIn(reply, urls, seenUrl)
    }
    for (const part of parts(message)) {
      if (part.type !== "tool-call") continue
      const input = inputRecord(part.input)
      const name = part.name ?? ""
      if (FILE_TOOLS.has(name)) {
        const file = input.path ?? input.filePath ?? input.file
        if (typeof file === "string") addUnique(files, seenFile, file)
      }
      const command = input.command
      if (typeof command === "string") {
        urlsIn(command, urls, seenUrl)
        for (const line of command.split("\n")) {
          if (GIT_RE.test(line)) addUnique(git, seenGit, clip(line.trim(), 300))
        }
      }
    }
  }

  return {
    requests: keepEnds(requests, 150, 30),
    urls: urls.slice(-120),
    files: files.slice(-120),
    git: git.slice(-40),
    lastReply: lastReply === undefined ? undefined : clip(lastReply, 6_000),
  }
}

function list(items: ReadonlyArray<string>, empty = "（无）") {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : empty
}

export function renderLedger(input: {
  readonly ledger: Ledger
  readonly at: Date
  readonly reason: string
  readonly tokens?: number
  readonly round: number
}) {
  const { ledger } = input
  const requests = ledger.requests.length
    ? ledger.requests.map((text, i) => `${i + 1}. ${text.replace(/\n/g, "\n   ")}`).join("\n")
    : "（无）"
  return [
    `## 第 ${input.round} 次压缩 · ${input.at.toLocaleString("zh-CN", { hour12: false })}`,
    "",
    `触发：${input.reason}${input.tokens ? `，压缩前上下文约 ${Math.round(input.tokens / 1000)}k token` : ""}`,
    "",
    "### 用户原始需求（按时间顺序，原文）",
    "",
    requests,
    "",
    "### 链接",
    "",
    list(ledger.urls),
    "",
    "### 新建或修改的文件",
    "",
    list(ledger.files),
    "",
    "### Git 操作",
    "",
    list(ledger.git.map((line) => `\`${line.replace(/`/g, "'")}\``)),
    "",
    "### 压缩前最后一条回复",
    "",
    ledger.lastReply ?? "（无）",
    "",
  ].join("\n")
}

export function slug(title: string) {
  const cleaned = title
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  return cleaned.slice(0, 40) || "session"
}

export function renderPolicy(rows: ReadonlyArray<{ model: string; plan: Plan }>, target: number, at: Date) {
  const k = (n: number) => (Number.isFinite(n) ? `${Math.round(n / 1000)}k` : "不自动压缩")
  const body = [...rows]
    .sort((a, b) => a.model.localeCompare(b.model))
    .map(
      ({ model, plan }) =>
        `| ${model} | ${k(plan.window)} | ${k(plan.trigger)} | ${plan.by === "plugin" ? "auto-handoff" : "OpenCode 默认"} |`,
    )
  return [
    "# 自动压缩策略",
    "",
    `由 auto-handoff 插件根据当前模型列表自动生成（${at.toLocaleString("zh-CN", { hour12: false })}）。`,
    `规则：上下文到 ${k(target)} 时压缩；模型窗口太小时沿用 OpenCode 默认（窗口的 85%，至少留 16k）。`,
    "",
    "| 模型 | 可用输入窗口 | 压缩触发点 | 由谁触发 |",
    "| --- | ---: | ---: | --- |",
    ...body,
    "",
  ].join("\n")
}
