import { Plugin } from "@opencode/plugin/tui"
import { Definition, type Health } from "./rpc.ts"

const icon = { available: "●", unavailable: "✗", unknown: "?" } as const

export default Plugin.define({
  id: "model-health",
  setup(ctx) {
    const options = () => (ctx.location ? { location: { directory: ctx.location.directory } } : undefined)
    const rpc = () => ctx.client.rpc(Definition)
    const describe = (health: Health) =>
      [health.status, health.reason, health.latencyMs === undefined ? undefined : `${health.latencyMs}ms`]
        .filter(Boolean)
        .join(" · ")

    const checkCurrent = async () => {
      const model = ctx.ui.model.current()
      if (!model) return ctx.ui.toast.show({ message: "No model selected", variant: "warning" })
      ctx.ui.toast.show({ message: `Checking ${model.providerID}/${model.modelID}…`, variant: "info" })
      const health = await rpc().check({ providerID: model.providerID, modelID: model.modelID, force: true }, options())
      ctx.ui.toast.show({
        title: `${model.providerID}/${model.modelID}`,
        message: describe(health),
        variant: health.status === "available" ? "success" : "error",
      })
    }

    const checkAll = async () => {
      const models = (await ctx.client.model.list(options())).data
      ctx.ui.toast.show({ message: `Checking ${models.length} models; this sends one small request each.`, variant: "info" })
      const results = new Map<string, Health>()
      const queue = [...models]
      // Two workers keep provider rate limits comfortable while still finishing quickly.
      const worker = async () => {
        for (let model = queue.shift(); model; model = queue.shift()) {
          const health = await rpc().check({ providerID: model.providerID, modelID: model.id }, options())
          results.set(`${model.providerID}/${model.id}`, health)
        }
      }
      await Promise.all([worker(), worker()])
      const selected = await ctx.ui.dialog.select({
        title: "Model health",
        placeholder: "Select a model to re-check it",
        options: models.map((model) => {
          const key = `${model.providerID}/${model.id}`
          const health = results.get(key)
          return {
            title: `${icon[health?.status ?? "unknown"]} ${model.name}`,
            value: key,
            category: model.providerID,
            description: health ? describe(health) : undefined,
          }
        }),
      })
      if (!selected) return
      const model = models.find((item) => `${item.providerID}/${item.id}` === selected)
      if (!model) return
      const health = await rpc().check({ providerID: model.providerID, modelID: model.id, force: true }, options())
      ctx.ui.toast.show({
        title: selected,
        message: describe(health),
        variant: health.status === "available" ? "success" : "error",
      })
    }

    const run = (task: () => Promise<unknown>) => () => {
      void task().catch((error: unknown) =>
        ctx.ui.toast.show({
          title: "Model health",
          message:
            typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error),
          variant: "error",
        }),
      )
    }

    ctx.ui.slot({
      append: "app",
      render() {
        ctx.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "model-health.current",
              title: "Check current model health",
              group: "Model",
              slash: { name: "health" },
              palette: true,
              run: run(checkCurrent),
            },
            {
              id: "model-health.all",
              title: "Check all models health",
              group: "Model",
              slash: { name: "health-all" },
              palette: true,
              run: run(checkAll),
            },
          ],
        }))
        return null
      },
    })
  },
})
