#!/usr/bin/env bun
/**
 * Backfill a handoff file for sessions that were compacted before auto-handoff was installed.
 *
 *   bun packages/auto-handoff/backfill.ts ses_xxx [ses_yyy ...]
 *
 * Reads the session history from the local OpenCode database (read-only), writes
 * `<dir>/<date>_<title>_<sessionID>.md` with the same layout the plugin uses (the plugin keeps appending to it),
 * and pins the file into the session's instructions through the running service.
 */
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { extractLedger, renderLedger, slug, type LedgerMessage } from "./lib.ts"

const DB = path.join(homedir(), ".local/share/opencode/opencode-local.db")
const SERVICE = path.join(homedir(), ".local/state/opencode/service-local.json")
const DIR = path.join(homedir(), "Documents/Codex/handoffs")

interface Row {
  type: string
  seq: number
  time_created: number
  data: string
}

function toMessage(row: Row): LedgerMessage | undefined {
  const data = JSON.parse(row.data)
  if (row.type === "user") return { role: "user", content: [{ type: "text", text: data.text ?? "" }] }
  if (row.type !== "assistant") return undefined
  const content = (data.content ?? []).flatMap((part: any) => {
    if (part.type === "text") return [{ type: "text", text: part.text }]
    if (part.type === "tool") return [{ type: "tool-call", name: part.name, input: part.state?.input }]
    return []
  })
  return { role: "assistant", content }
}

async function pin(sessionID: string, file: string) {
  const service = JSON.parse(readFileSync(SERVICE, "utf8")) as { url: string; password: string }
  const response = await fetch(
    `${service.url}/api/experimental/session/${sessionID}/instructions/entries/auto-handoff`,
    {
      method: "PUT",
      headers: {
        authorization: `Basic ${btoa(`opencode:${service.password}`)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        value:
          `本会话较早的上下文已被压缩。压缩前自动保存的用户原始需求、链接、改动文件、Git 操作和摘要在 ${file}。` +
          "需要早期细节（用户原话、ID、链接、命令、结论）时先读这个文件，不要凭记忆猜。",
      }),
    },
  )
  if (!response.ok) throw new Error(`pin failed: ${response.status} ${await response.text()}`)
}

const db = new Database(DB, { readonly: true })
for (const sessionID of process.argv.slice(2)) {
  const session = db
    .query("select title, directory, parent_id, time_created from session_v2 where id = ?")
    .get(sessionID) as { title: string; directory: string; parent_id: string | null; time_created: number } | null
  if (!session) {
    console.error(`${sessionID}: not found`)
    continue
  }
  const rows = db
    .query("select type, seq, time_created, data from session_message where session_id = ? order by seq")
    .all(sessionID) as Row[]
  const compactions = rows.filter((row) => row.type === "compaction")
  const lastCompaction = compactions.at(-1)
  if (!lastCompaction) {
    console.error(`${sessionID}: never compacted, nothing to backfill`)
    continue
  }
  const before = rows.filter((row) => row.seq < lastCompaction.seq)
  const messages = before.map(toMessage).filter((message): message is LedgerMessage => message !== undefined)
  const ledger = extractLedger(messages)

  const date = new Date(session.time_created).toISOString().slice(0, 10)
  const file = path.join(DIR, `${date}_${slug(session.title ?? "")}_${sessionID}.md`)
  if (existsSync(file)) {
    console.error(`${sessionID}: ${file} already exists, skipped`)
    continue
  }
  mkdirSync(DIR, { recursive: true })

  const summaries = compactions.map((row, i) => {
    const data = JSON.parse(row.data)
    const at = new Date(row.time_created).toLocaleString("zh-CN", { hour12: false })
    return `### 第 ${i + 1} 次压缩摘要（${at}，${data.reason ?? "未知"}，模型生成）\n\n${(data.summary ?? "").trim() || "（空）"}\n`
  })

  const text = [
    `# 会话交接：${session.title ?? sessionID}`,
    "",
    `- 会话：${sessionID}${session.parent_id ? `（子会话，父会话 ${session.parent_id}）` : ""}`,
    `- 目录：${session.directory}`,
    "- 每次压缩前自动追加一节：用户原始需求、链接、改动文件、Git 操作、压缩前最后回复，以及压缩后模型生成的摘要。",
    `- 本文件由 backfill 脚本补档：覆盖截至 ${new Date(lastCompaction.time_created).toLocaleString("zh-CN", { hour12: false })} 最近一次压缩之前的全部历史（${messages.length} 条消息）。`,
    "",
    renderLedger({ ledger, at: new Date(lastCompaction.time_created), reason: "补档（插件安装前已压缩）", round: 0 }).replace(
      "## 第 0 次压缩",
      "## 补档",
    ),
    "## 历次压缩摘要",
    "",
    ...summaries,
  ].join("\n")
  writeFileSync(file, text)
  await pin(sessionID, file)
  console.log(
    `${sessionID}: ${file} (${ledger.requests.length} requests, ${ledger.urls.length} links, ${ledger.files.length} files, ${ledger.git.length} git ops, ${compactions.length} summaries)`,
  )
}
