import { describe, expect, test } from "bun:test"
import { builtinTrigger, extractLedger, planFor, promptTokens, renderLedger, renderPolicy, slug } from "../lib.ts"

describe("planFor", () => {
  test("1M window compacts at 300k", () => {
    expect(planFor({ context: 1_000_000, output: 128_000 })).toEqual({ window: 1_000_000, trigger: 300_000, by: "plugin" })
  })
  test("input limit caps the window", () => {
    expect(planFor({ context: 1_050_000, input: 922_000 }).window).toBe(922_000)
    expect(planFor({ context: 1_050_000, input: 922_000 }).trigger).toBe(300_000)
  })
  test("small windows keep the built-in trigger", () => {
    expect(planFor({ context: 200_000 })).toEqual({ window: 200_000, trigger: 170_000, by: "builtin" })
    expect(planFor({ context: 131_072 }).by).toBe("builtin")
  })
  test("unknown window never auto-compacts", () => {
    expect(builtinTrigger(0)).toBe(Number.POSITIVE_INFINITY)
    expect(planFor({}).by).toBe("builtin")
  })
  test("custom target", () => {
    expect(planFor({ context: 1_000_000 }, 400_000).trigger).toBe(400_000)
  })
})

test("promptTokens sums prompt and reply", () => {
  expect(promptTokens({ input: 2, output: 1_000, cache: { read: 700_000, write: 500 } })).toBe(701_502)
  expect(promptTokens(undefined)).toBe(0)
})

test("extractLedger keeps user requests, links, files and git operations", () => {
  const ledger = extractLedger([
    { role: "user", content: [{ type: "text", text: "Instructions from: AGENTS.md" }] },
    {
      role: "user",
      content: [{ type: "text", text: "<system-reminder>x</system-reminder>部署到泳道 ppe_x，工单 https://a.example/t/1。" }],
    },
    {
      role: "assistant",
      content: [
        { type: "text", text: "见 https://code.example/mr/2" },
        { type: "tool-call", name: "write", input: { path: "/repo/a.go" } },
        { type: "tool-call", name: "shell", input: JSON.stringify({ command: "cd x && git commit -m hi\ngit push origin feat" }) },
      ],
    },
    { role: "tool", content: [{ type: "tool-result", text: "https://noise.example/log" }] },
  ])
  expect(ledger.requests).toEqual(["部署到泳道 ppe_x，工单 https://a.example/t/1。"])
  expect(ledger.urls).toEqual(["https://a.example/t/1", "https://code.example/mr/2"])
  expect(ledger.files).toEqual(["/repo/a.go"])
  expect(ledger.git).toEqual(["cd x && git commit -m hi", "git push origin feat"])
  expect(ledger.lastReply).toBe("见 https://code.example/mr/2")
  const text = renderLedger({ ledger, at: new Date(0), reason: "test", tokens: 301_000, round: 1 })
  expect(text).toContain("第 1 次压缩")
  expect(text).toContain("301k")
})

test("slug and policy rendering", () => {
  expect(slug("实时讲品 / trace: 设计")).toBe("实时讲品-trace-设计")
  expect(slug("")).toBe("session")
  const policy = renderPolicy([{ model: "a/b", plan: planFor({ context: 1_000_000 }) }], 300_000, new Date(0))
  expect(policy).toContain("| a/b | 1000k | 300k | auto-handoff |")
})
