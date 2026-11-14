import { Plugin } from "@opencode/plugin"
import { appendFile, mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import {
  DEFAULT_TARGET,
  extractLedger,
  planFor,
  promptTokens,
  renderLedger,
  renderPolicy,
  slug,
  SUMMARY_INSTRUCTION,
  type LedgerMessage,
  type Limit,
} from "./lib.ts"

/**
 * auto-handoff
 *
 * 1. Compacts a session once its prompt reaches `target` tokens (300k by default) on any model whose window is large
 *    enough; smaller windows keep OpenCode's built-in trigger. Thresholds come from the live model list, so models
 *    added later are covered without config changes. The current table is written to `<dir>/_compaction-policy.md`.
 * 2. Before every compaction (automatic, plugin-triggered or `/compact`), saves the user's original requests, links,
 *    changed files, git operations and the last reply to `<dir>/<date>_<title>_<sessionID>.md`, asks the summary for a
 *    verbatim key-facts ledger, appends that summary to the same file afterwards, and pins the file path into the
 *    session's instructions so the agent knows where to look after compaction.
 */

interface Shared {
  /** `provider/model` -> limit, rebuilt whenever the model list changes. */
  windows: Map<string, Limit>
  /** assistantMessageID -> `provider/model`, from `session.step.started`. */
  stepModel: Map<string, string>
  /** sessionID -> time a plugin compaction was requested. */
  pending: Map<string, number>
  /** sessionID -> time the pre-compaction ledger was written; hooks may run once per plugin instance. */
  ledgered: Map<string, number>
  /** compaction-ended event IDs already appended. */
  ended: Set<string>
  /** sessionID -> handoff file. */
  files: Map<string, string>
  /** sessionID -> estimated prompt tokens at the last step. */
  lastTokens: Map<string, number>
}

const shared: Shared = ((globalThis as Record<string, unknown>).__autoHandoff ??= {
  windows: new Map(),
  stepModel: new Map(),
  pending: new Map(),
  ledgered: new Map(),
  ended: new Set(),
  files: new Map(),
  lastTokens: new Map(),
}) as Shared

const PENDING_TTL = 15 * 60_000
const LEDGER_DEDUPE = 2 * 60_000

function trim<K, V>(map: Map<K, V>, max = 2_000) {
  while (map.size > max) {
    const first = map.keys().next().value
    if (first === undefined) return
    map.delete(first)
  }
}

function expand(dir: string) {
  return dir.startsWith("~") ? path.join(homedir(), dir.slice(1)) : path.resolve(dir)
}

function log(message: string, extra?: Record<string, unknown>) {
  console.info(`[auto-handoff] ${message}`, extra ?? "")
}

export default Plugin.define({
  id: "local.auto-handoff",
  async setup(ctx) {
    const options = (ctx.options ?? {}) as Record<string, unknown>
    const target = Number(options.target ?? DEFAULT_TARGET) || DEFAULT_TARGET
    const dir = expand(typeof options.dir === "string" ? options.dir : "~/Documents/Codex/handoffs")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = ctx.session as any

    let policyTimer: ReturnType<typeof setTimeout> | undefined
    const writePolicy = () => {
      if (policyTimer) clearTimeout(policyTimer)
      policyTimer = setTimeout(() => {
        const rows = [...shared.windows].map(([model, limit]) => ({ model, plan: planFor(limit, target) }))
        void mkdir(dir, { recursive: true })
          .then(() => writeFile(path.join(dir, "_compaction-policy.md"), renderPolicy(rows, target, new Date())))
          .catch((error) => console.warn("[auto-handoff] failed to write policy", error))
      }, 2_000)
    }

    await ctx.model.transform((editor) => {
      shared.windows.clear()
      for (const model of editor.list()) {
        if (!model.enabled) continue
        shared.windows.set(`${model.providerID}/${model.id}`, { ...model.limit })
      }
      writePolicy()
    })

    const handoffFile = async (sessionID: string) => {
      const known = shared.files.get(sessionID) ?? ((await ctx.storage.get(`file/${sessionID}`)) as string | undefined)
      if (known) {
        shared.files.set(sessionID, known)
        return { file: known, created: false }
      }
      const info = await session.get({ sessionID }).catch(() => undefined)
      const date = new Date(info?.time?.created ?? Date.now()).toISOString().slice(0, 10)
      const file = path.join(dir, `${date}_${slug(info?.title ?? "")}_${sessionID}.md`)
      shared.files.set(sessionID, file)
      await ctx.storage.set(`file/${sessionID}`, file)
      await mkdir(dir, { recursive: true })
      const header = [
        `# 会话交接：${info?.title ?? sessionID}`,
        "",
        `- 会话：${sessionID}${info?.parentID ? `（子会话，父会话 ${info.parentID}）` : ""}`,
        `- 目录：${info?.location?.directory ?? "未知"}`,
        "- 每次压缩前自动追加一节：用户原始需求、链接、改动文件、Git 操作、压缩前最后回复，以及压缩后模型生成的摘要。",
        "",
      ].join("\n")
      await writeFile(file, header, { flag: "a" })
      return { file, created: true }
    }

    const pin = async (sessionID: string, file: string) => {
      await session.instructions?.entry
        ?.put({
          sessionID,
          key: "auto-handoff",
          value:
            `本会话较早的上下文已被压缩。压缩前自动保存的用户原始需求、链接、改动文件、Git 操作和摘要在 ${file}。` +
            "需要早期细节（用户原话、ID、链接、命令、结论）时先读这个文件，不要凭记忆猜。",
        })
        .catch((error: unknown) => console.warn("[auto-handoff] failed to pin handoff file", error))
    }

    // Before any compaction: save the ledger, and ask the summary for a verbatim key-facts section.
    await session.hook("compaction", async (event: {
      sessionID: string
      system: Array<{ type: "text"; text: string }>
      messages: LedgerMessage[]
    }) => {
      event.system.push({ type: "text", text: SUMMARY_INSTRUCTION })
      const sessionID = `${event.sessionID}`
      const last = shared.ledgered.get(sessionID)
      if (last && Date.now() - last < LEDGER_DEDUPE) return
      shared.ledgered.set(sessionID, Date.now())
      trim(shared.ledgered)
      try {
        const { file } = await handoffFile(sessionID)
        const round = (((await ctx.storage.get(`round/${sessionID}`)) as number | undefined) ?? 0) + 1
        await ctx.storage.set(`round/${sessionID}`, round)
        const reason = shared.pending.has(sessionID)
          ? `auto-handoff（上下文超过 ${Math.round(target / 1000)}k）`
          : "OpenCode 自动压缩或手动 /compact"
        const section = renderLedger({
          ledger: extractLedger(event.messages),
          at: new Date(),
          reason,
          tokens: shared.lastTokens.get(sessionID),
          round,
        })
        await appendFile(file, `\n${section}`)
        log("ledger saved", { sessionID, file, round })
      } catch (error) {
        console.warn("[auto-handoff] failed to save ledger", error)
      }
    })

    const controller = new AbortController()
    void (async () => {
      // `types` filtering exists at runtime but is missing from the pinned @opencode/plugin typings.
      const subscribe = ctx.event.subscribe as (options: unknown) => AsyncIterable<unknown>
      for await (const raw of subscribe({
        types: [
          "session.step.started",
          "session.step.ended",
          "session.compaction.ended",
          "session.compaction.failed",
        ],
        signal: controller.signal,
      })) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const event = raw as any
        try {
          const sessionID = `${event.data.sessionID}`
          if (event.type === "session.step.started") {
            shared.stepModel.set(`${event.data.assistantMessageID}`, `${event.data.model.providerID}/${event.data.model.id}`)
            trim(shared.stepModel)
            continue
          }
          if (event.type === "session.step.ended") {
            const tokens = promptTokens(event.data.tokens)
            const model = shared.stepModel.get(`${event.data.assistantMessageID}`)
            shared.stepModel.delete(`${event.data.assistantMessageID}`)
            shared.lastTokens.set(sessionID, tokens)
            trim(shared.lastTokens)
            if (tokens < target || !model) continue
            const limit = shared.windows.get(model)
            if (!limit) continue
            const plan = planFor(limit, target)
            if (plan.by !== "plugin" || tokens < plan.trigger) continue
            const since = shared.pending.get(sessionID)
            if (since && Date.now() - since < PENDING_TTL) continue
            shared.pending.set(sessionID, Date.now())
            await session.compact({ sessionID })
            log("compaction requested", { sessionID, model, tokens, trigger: plan.trigger })
            continue
          }
          shared.pending.delete(sessionID)
          if (event.type !== "session.compaction.ended") continue
          const id = `${event.id}`
          if (shared.ended.has(id)) continue
          shared.ended.add(id)
          if (shared.ended.size > 2_000) shared.ended.clear()
          const { file } = await handoffFile(sessionID)
          const text = typeof event.data.text === "string" ? event.data.text.trim() : ""
          await appendFile(file, `\n### 压缩摘要（模型生成）\n\n${text || "（摘要为空或为加密的原生压缩）"}\n`)
          await pin(sessionID, file)
          log("summary appended", { sessionID, file })
        } catch (error) {
          console.warn("[auto-handoff] event handling failed", error)
        }
      }
    })().catch((error) => {
      if (!controller.signal.aborted) console.warn("[auto-handoff] event stream stopped", error)
    })

    return () => {
      controller.abort()
      if (policyTimer) clearTimeout(policyTimer)
    }
  },
})
