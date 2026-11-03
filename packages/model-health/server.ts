import { Plugin } from "@opencode/plugin"
import { Definition, type CheckInput, type Health, type Reason } from "./rpc.ts"

type Probe = Omit<Health, "checkedAt">

export default Plugin.define({
  id: "model-health",
  setup: async (ctx) => {
    const ttl = number(ctx.options.ttlMs, 60_000)
    const timeout = number(ctx.options.timeoutMs, 15_000)
    const prompt = typeof ctx.options.prompt === "string" ? ctx.options.prompt : "Reply with OK."
    // `ctx.generate` is deprecated in favour of `ctx.experimental.generate` from 2.2; keep both working.
    const generate: Pick<typeof ctx.generate, "text"> =
      "generate" in ctx.experimental ? (ctx.experimental.generate as typeof ctx.generate) : ctx.generate
    const cache = new Map<string, Health>()
    const inflight = new Map<string, Promise<Health>>()

    const probe = async (input: CheckInput): Promise<Probe> => {
      const models = await ctx.model.list()
      const model = models.data.find((item) => item.providerID === input.providerID && item.id === input.modelID)
      if (!model) return { status: "unavailable", reason: "not_found" }
      const started = Date.now()
      const outcome = await Promise.race([
        generate
          .text({ prompt, model: { providerID: model.providerID, id: model.id } })
          .then(() => "ok" as const, (error: unknown) => ({ error })),
        Bun.sleep(timeout).then(() => "timeout" as const),
      ])
      if (outcome === "ok") return { status: "available", latencyMs: Date.now() - started }
      if (outcome === "timeout") return { status: "unavailable", reason: "timeout" }
      return { status: "unavailable", reason: classify(outcome.error) }
    }

    // Probes run only on request: results are cached for `ttlMs` and concurrent checks of one model share a request.
    const check = (input: CheckInput) => {
      const key = JSON.stringify([input.providerID, input.modelID])
      const cached = cache.get(key)
      if (!input.force && cached && Date.now() - cached.checkedAt < ttl) return Promise.resolve(cached)
      const running = inflight.get(key)
      if (running) return running
      const task = probe(input)
        .catch((): Probe => ({ status: "unavailable", reason: "unknown" }))
        .then((result) => {
          const health = { ...result, checkedAt: Date.now() }
          cache.set(key, health)
          return health
        })
        .finally(() => inflight.delete(key))
      inflight.set(key, task)
      return task
    }

    await ctx.rpc.register(Definition, { check: (input) => check(input) })
  },
})

function number(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

// Newer OpenCode returns `ProviderRequestError` with a structured `reason`; older versions only expose a tag and a
// message, so the reason is inferred from those as a fallback.
const structured: Record<string, Reason> = {
  authentication: "authentication",
  rate_limit: "rate_limit",
  content_filter: "provider",
  invalid_request: "configuration",
  overloaded: "provider",
  provider: "provider",
}

function classify(error: unknown): Reason {
  const tag = typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : ""
  const message =
    typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error)
  const reason = typeof error === "object" && error !== null && "reason" in error ? String(error.reason) : ""
  if (tag.endsWith("ProviderRequestError") && reason in structured) return structured[reason]!
  if (tag.endsWith("ModelNotFoundError")) return "not_found"
  if (tag.endsWith("UnsupportedModelError")) return "unsupported"
  if (tag === "Generate.ModelSelectionError" || tag.endsWith("InvalidRequestError")) return "configuration"
  const rules: ReadonlyArray<readonly [Reason, RegExp]> = [
    ["authentication", /\b40[13]\b|unauthori[sz]ed|authenticat|api[ -]?key|credential|forbidden/i],
    ["rate_limit", /\b429\b|rate.?limit|too many requests/i],
    ["quota", /quota|insufficient|billing|balance|exceeded your/i],
    ["not_found", /\b404\b|model.*(not (found|exist)|unknown|invalid)|no such model/i],
    ["timeout", /timed? ?out|timeout|deadline/i],
    ["network", /ECONN|ENOTFOUND|EAI_AGAIN|socket|network|fetch failed|transport/i],
    ["provider", /\b5\d\d\b|internal|overloaded|unavailable|bad gateway/i],
  ]
  return rules.find(([, pattern]) => pattern.test(message))?.[0] ?? "unknown"
}
