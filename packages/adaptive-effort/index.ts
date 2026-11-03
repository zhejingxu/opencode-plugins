import { Plugin } from "@opencode/plugin"

type Tier = "low" | "medium" | "high"
type Role = "main" | "subagent-explore" | "subagent-general" | "compaction" | "title" | "generate"

const SYNTHETIC_PREFIXES = [
  "Instructions from: ",
  "<system-update>",
  "<conversation-checkpoint>",
  "<shell ",
  "The server restarted while you were working.",
]

const SUBAGENT_BANNER = "You are a subagent spawned by another session."

const FORCE_HIGH_RE = /(?:^|\s)(?:#high|\[high\])|深度思考|深度排查/i
const FORCE_MEDIUM_RE = /(?:^|\s)(?:#medium|\[medium\])/i
const FORCE_LOW_RE = /(?:^|\s)(?:#low|\[low\])/i
const CONTINUE_RE = /^(?:继续|接着(?:弄|跑|做|查|改)?|好[的吧]?[，,\s]*继续|continue|go on)[\s。！!.]*$/i

const HIGH_COMPLEXITY_RE =
  /排查|根因|为什么.*(?:报错|失败|卡|慢|丢|超时|异常|不生效|不对)|报错|异常|超时|死锁|竞态|并发|幂等|丢失|泄漏|告警|挂了|崩了|卡死|架构|重构|技术方案|上下游|端到端|迁移方案|鉴权|授权缺失|\b(?:bug|panic|deadlock|race\s+condition|oom|traceback|exception|stack\s*trace|segfault)\b/i

const MEDIUM_TASK_RE =
  /样式|布局|界面|前端|展示|隐藏|去掉|删掉|折叠|展开|收起|颜色|字体|字号|图标|文案|按钮|对齐|间距|宽度|高度|看板|报表|日趋|周趋|筛选项|表头|列名|模板|配置|参数|热加载|偏好|记下来|写进|润色|排版|注释|汇总|总结|看下进度|进度如何|\b(?:ui|css|html|reload|readme|agents\.md)\b/i

const TOOL_FAILURE_RE =
  /Traceback \(most recent call last\)|FAILED \((?:failures|errors)=|"code"\s*:\s*"CLI_PARSE_ERROR"|Exited with code [1-9]/

const SUFFIX_RE = /^(.*)-(low|medium|high)$/

interface Decision {
  readonly role: Role
  readonly tier: Tier
}

function cleanUserText(raw: string) {
  return raw
    .replace(/^You are a subagent spawned by another session\.\s*/i, "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, " ")
    .replace(/Attached file:\s*`[^`]+`/g, " ")
    .trim()
}

function messageText(content: ReadonlyArray<{ readonly type: string; readonly text?: string | null }>) {
  return content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim()
}

function isSyntheticUserText(text: string) {
  if (!text) return true
  return SYNTHETIC_PREFIXES.some((prefix) => text.startsWith(prefix))
}

function extractTurnContext(
  messages: ReadonlyArray<{
    readonly id?: string
    readonly role: string
    readonly content: ReadonlyArray<{
      readonly type: string
      readonly text?: string | null
      readonly result?: { readonly type: string; readonly value: unknown }
    }>
  }>,
) {
  let userIndex = -1
  let userText = ""
  let spawnedSubagent = false

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (!msg || msg.role !== "user") continue
    const text = messageText(msg.content)
    if (text.startsWith(SUBAGENT_BANNER)) spawnedSubagent = true
    if (isSyntheticUserText(text)) continue
    userIndex = i
    userText = cleanUserText(text)
  }

  let toolFailures = 0
  for (let i = Math.max(0, userIndex + 1); i < messages.length; i++) {
    const msg = messages[i]
    if (!msg) continue
    for (const part of msg.content) {
      if (part.type !== "tool-result" || !part.result) continue
      if (part.result.type === "error-text" || part.result.type === "error-json") {
        toolFailures++
        continue
      }
      const val = typeof part.result.value === "string" ? part.result.value : JSON.stringify(part.result.value ?? "")
      if (TOOL_FAILURE_RE.test(val)) toolFailures++
    }
  }

  const anchor = userIndex >= 0 ? (messages[userIndex]?.id ?? `${userIndex}:${userText.slice(0, 80)}`) : "initial"
  return { anchor, userText, toolFailures, spawnedSubagent }
}

function classifyPrimaryTier(userText: string, previous: Tier | undefined): Tier {
  if (!userText) return previous ?? "high"
  if (FORCE_HIGH_RE.test(userText)) return "high"
  if (FORCE_MEDIUM_RE.test(userText)) return "medium"
  if (FORCE_LOW_RE.test(userText)) return "low"
  if (CONTINUE_RE.test(userText)) return previous ?? "high"
  if (HIGH_COMPLEXITY_RE.test(userText)) return "high"
  if (userText.includes("```") && userText.length > 180) return "high"
  if (userText.length > 360) return "high"
  if (MEDIUM_TASK_RE.test(userText)) return "medium"
  if (userText.length <= 140) return "medium"
  return "high"
}

function supportsEffortOption(providerID: string, modelID: string) {
  if (SUFFIX_RE.test(modelID)) return false
  const lower = modelID.toLowerCase()
  return (
    providerID === "gateway" ||
    providerID === "relay" ||
    lower.includes("claude-opus-5") ||
    lower.includes("claude-sonnet-5") ||
    lower.includes("claude-fable-5") ||
    lower.includes("gpt-5.") ||
    lower.includes("gpt-6")
  )
}

export default Plugin.define({
  id: "local.adaptive-effort",
  async setup(ctx) {
    const availableByProvider = new Map<string, Set<string>>()
    const turnDecisions = new Map<string, Tier>()
    const lastPrimaryTier = new Map<string, Tier>()
    const nextRequestDecision = new Map<string, Decision>()

    // Track active models per provider synchronously via model.transform so there is zero RPC overhead.
    await ctx.model.transform((editor) => {
      availableByProvider.clear()
      for (const model of editor.list()) {
        if (!model.enabled) continue
        // Editor values are DeepMutable copies of branded IDs; normalise them back to plain strings.
        const providerID = `${model.providerID}`
        const set = availableByProvider.get(providerID) ?? new Set<string>()
        set.add(`${model.id}`)
        availableByProvider.set(providerID, set)
      }
    })

    const trimMap = <K, V>(map: Map<K, V>, max = 500) => {
      if (map.size <= max) return
      const first = map.keys().next().value
      if (first !== undefined) map.delete(first)
    }

    /**
     * Maps `(providerID, currentModelID, decision)` to the target model ID within the SAME provider & model ecosystem:
     * - Main session (`role === "main"`): keeps the flagship model family (e.g. Opus stays Opus, Argon stays Argon),
     *   only adjusting `-high` -> `-medium` / `-low` when appropriate.
     * - Subagents (`subagent-explore`, `subagent-general`) & auxiliary (`title`, `compaction`, `generate`):
     *   routes worker tasks to cheaper, faster sibling models in the same ecosystem:
     *   - Claude Opus / Fable -> Claude Sonnet 5.5 (`low` for explore/title, `medium` for general/compaction)
     *   - Gemini 4 Argon -> `gemini-4-argon-low` (explore/title) or `gemini-4-argon-medium` (general/compaction)
     *   - GPT-6 Sol / Astra -> `gpt-6-luna` (for explore/title)
     */
    const resolveTargetModel = (providerID: string, currentModelID: string, decision: Decision): string | undefined => {
      const known = availableByProvider.get(providerID)
      const has = (id: string) => (known ? known.has(id) : true)
      const { role, tier } = decision
      const isWorker = role !== "main"

      const suffixMatch = SUFFIX_RE.exec(currentModelID)
      if (suffixMatch) {
        let prefix = suffixMatch[1]!
        const currentTier = suffixMatch[2] as Tier

        // For subagents / compaction / title on suffix-based Claude Opus, step down to Sonnet in the same provider.
        if (isWorker && prefix.startsWith("claude-opus-5-5") && has(`claude-sonnet-5-5-${tier}`)) {
          return `claude-sonnet-5-5-${tier}`
        }

        if (!isWorker) {
          if (currentTier === "low") return undefined
          if (currentTier === "medium" && tier !== "low") return undefined
        }

        if (tier === currentTier && prefix === suffixMatch[1]) return undefined
        const candidates =
          tier === "low"
            ? [`${prefix}-low`, `${prefix}-medium`]
            : tier === "medium"
              ? [`${prefix}-medium`]
              : [`${prefix}-high`]
        return candidates.find(has)
      }

      // Non-suffix Claude models (e.g. `gateway/claude-opus-5-5`, `gateway/claude-fable-5`):
      // Route subagents, title, and compaction to Sonnet 5.5 / 5 on the same gateway.
      if (isWorker && /^claude-(?:opus|fable)-5/.test(currentModelID)) {
        for (const candidate of ["claude-sonnet-5-5", "claude-sonnet-5"]) {
          if (has(candidate)) return candidate
        }
      }

      // Non-suffix GPT-6 models on `relay`: route fast explore/title workers to `gpt-6-luna` when present.
      if ((role === "subagent-explore" || role === "title") && /^gpt-6(?:\.1)?-(?:sol|astra)$/.test(currentModelID)) {
        if (has("gpt-6-luna")) return "gpt-6-luna"
      }

      return undefined
    }

    const recordDecision = (
      sessionID: string,
      kind: "primary" | "compaction" | "title" | "generate",
      model: { readonly providerID: string; readonly id: string; readonly variant?: string },
      options: Record<string, unknown>,
      decision: Decision,
    ) => {
      nextRequestDecision.set(`${sessionID}:${kind}`, decision)
      trimMap(nextRequestDecision)

      const explicitVariant = model.variant !== undefined && model.variant !== "default"
      if (explicitVariant && decision.role === "main") return
      if (options.reasoningEffort !== undefined) return
      const effectiveModel = resolveTargetModel(model.providerID, model.id, decision) ?? model.id
      if (!supportsEffortOption(model.providerID, effectiveModel)) return
      options.reasoningEffort = decision.tier
    }

    await ctx.session.hook("title", async (event) => {
      recordDecision(event.sessionID, "title", event.model, event.options, { role: "title", tier: "low" })
    })

    await ctx.session.hook("compaction", async (event) => {
      recordDecision(event.sessionID, "compaction", event.model, event.options, { role: "compaction", tier: "medium" })
    })

    await ctx.session.hook("generate", async (event) => {
      recordDecision(event.sessionID, "generate", event.model, event.options, { role: "generate", tier: "medium" })
    })

    await ctx.session.hook("context", async (event) => {
      const explicitVariant = event.model.variant !== undefined && event.model.variant !== "default"
      const { anchor, userText, toolFailures, spawnedSubagent } = extractTurnContext(event.messages)

      // Subagent routing ("爆兵"): fast & cheap worker models within the active model family!
      if (event.agent === "explore" || event.agent === "general" || spawnedSubagent) {
        if (explicitVariant) {
          nextRequestDecision.delete(`${event.sessionID}:primary`)
          return
        }
        const isExplore = event.agent === "explore"
        const thorough = /very\s+thorough|全面深入/i.test(userText)
        let tier: Tier = isExplore ? (thorough ? "medium" : "low") : "medium"
        if (toolFailures >= 2 && tier === "low") tier = "medium"
        else if (toolFailures >= 3) tier = "high"
        recordDecision(event.sessionID, "primary", event.model, event.options, {
          role: isExplore ? "subagent-explore" : "subagent-general",
          tier,
        })
        return
      }

      if (explicitVariant) {
        nextRequestDecision.delete(`${event.sessionID}:primary`)
        return
      }

      const decisionKey = `${event.sessionID}:${anchor}`
      let tier = turnDecisions.get(decisionKey)
      if (!tier) {
        tier = classifyPrimaryTier(userText, lastPrimaryTier.get(event.sessionID))
        turnDecisions.set(decisionKey, tier)
        trimMap(turnDecisions)
      }

      if (tier !== "high" && toolFailures >= 2) {
        tier = "high"
        turnDecisions.set(decisionKey, "high")
      }

      lastPrimaryTier.set(event.sessionID, tier)
      trimMap(lastPrimaryTier)
      recordDecision(event.sessionID, "primary", event.model, event.options, { role: "main", tier })
    })

    await ctx.session.hook("http.request", async (event) => {
      const key = `${event.sessionID}:${event.kind}`
      const isChildHeader = Boolean(event.request.headers.get("x-opencode-parent-session-id"))
      const fallback: Decision =
        event.kind === "title"
          ? { role: "title", tier: "low" }
          : event.kind === "compaction"
            ? { role: "compaction", tier: "medium" }
            : event.kind === "generate"
              ? { role: "generate", tier: "medium" }
              : isChildHeader
                ? { role: event.agent === "explore" ? "subagent-explore" : "subagent-general", tier: "medium" }
                : { role: "main", tier: "high" }

      const decision = nextRequestDecision.get(key) ?? fallback
      const explicitVariant = event.model.variant !== undefined && event.model.variant !== "default"
      if (explicitVariant && decision.role === "main") return

      const targetModel = resolveTargetModel(event.model.providerID, event.model.id, decision)
      if (!targetModel || targetModel === event.model.id) return
      if (event.request.method !== "POST" || !event.request.body) return
      const contentType = event.request.headers.get("content-type") ?? ""
      if (!contentType.includes("application/json")) return

      const raw = await event.request.clone().text().catch(() => "")
      if (!raw) return
      let body: Record<string, unknown>
      try {
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return
        body = parsed as Record<string, unknown>
      } catch {
        return
      }

      if (typeof body.model !== "string" || body.model === targetModel) return
      body.model = targetModel

      const headers = new Headers(event.request.headers)
      headers.delete("content-length")
      event.request = new Request(event.request.url, {
        method: event.request.method,
        headers,
        body: JSON.stringify(body),
      })
    })
  },
})
