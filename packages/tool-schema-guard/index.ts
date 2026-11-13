import { Plugin } from "@opencode/plugin"

// Hotfix for two upstream issues that together break the `explore` subagent:
// 1. A desktop browser attachment grants `browser` on the session; child sessions inherit it, and session rules
//    override the agent's own `deny *`, so read-only agents receive every browser tool. With Code Mode denied
//    (`explore` has no `execute`), those tools are sent to the model as native tools.
// 2. Gemini-style endpoints (Gemini API, Cloud Code) reject `enum` on non-string schemas, e.g. browser_click.count
//    `{ type: "number", enum: [1, 2] }`. Tool input is still validated by OpenCode after the call, so dropping the
//    keyword only loses a hint; the allowed values move into the description.

const READ_ONLY_AGENTS = new Set(["explore"])
const BROWSER_PREFIX = "browser_"

type Schema = Record<string, unknown>

const isRecord = (value: unknown): value is Schema =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const hasStringType = (schema: Schema) =>
  schema.type === "string" || (Array.isArray(schema.type) && schema.type.includes("string"))

const stripNonStringEnum = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripNonStringEnum)
  if (!isRecord(value)) return value
  const out: Schema = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === "enum" || key === "const" || key === "default" || key === "examples") out[key] = item
    else out[key] = stripNonStringEnum(item)
  }
  if (Array.isArray(out.enum) && out.type !== undefined && !hasStringType(out)) {
    const allowed = `Allowed values: ${out.enum.map((item) => JSON.stringify(item)).join(", ")}.`
    out.description = typeof out.description === "string" ? `${out.description} ${allowed}` : allowed
    delete out.enum
  }
  return out
}

export default Plugin.define({
  id: "local.tool-schema-guard",
  async setup(ctx) {
    await ctx.session.hook("context", async (event) => {
      for (const name of Object.keys(event.tools)) {
        if (READ_ONLY_AGENTS.has(`${event.agent}`) && name.startsWith(BROWSER_PREFIX)) {
          delete event.tools[name]
          continue
        }
        const tool = event.tools[name]!
        tool.input = stripNonStringEnum(tool.input) as typeof tool.input
      }
    })
  },
})
