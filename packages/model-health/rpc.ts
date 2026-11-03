import { Schema } from "effect"
import { Rpc } from "@opencode/plugin/rpc"

// Public contract shared by the server plugin, the TUI entry and any GUI client.
// Keep it free of runtime imports so clients can load it without the server code.

export const Reason = Schema.Literals([
  "not_found",
  "unsupported",
  "configuration",
  "authentication",
  "rate_limit",
  "quota",
  "provider",
  "timeout",
  "network",
  "unknown",
])
export type Reason = typeof Reason.Type

export const Health = Schema.Struct({
  status: Schema.Literals(["available", "unavailable", "unknown"]),
  checkedAt: Schema.Number.annotate({ description: "Unix timestamp in milliseconds when the probe completed." }),
  latencyMs: Schema.optional(Schema.Number),
  reason: Schema.optional(Reason),
})
export type Health = typeof Health.Type

export const CheckInput = Schema.Struct({
  providerID: Schema.String,
  modelID: Schema.String,
  force: Schema.optional(Schema.Boolean).annotate({ description: "Ignore a cached result and probe again." }),
})
export type CheckInput = typeof CheckInput.Type

export const Definition = Rpc.define({
  id: "model-health",
  methods: {
    check: {
      input: Schema.toStandardSchemaV1(CheckInput),
      output: Schema.toStandardSchemaV1(Health),
    },
  },
  events: {},
})
