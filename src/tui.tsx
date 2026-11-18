import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/plugin"
import { useKeyboard } from "@opentui/solid"
import {
  formatAIStatus,
  buildFallbackDigest,
  buildSummaryPrompt,
  chooseAutoModel,
  compareVersions,
  fetchLatestRelease,
  fetchReleaseRange,
  listFreeModels,
  normalizeVersion,
  type ModelCandidate,
  type ReleaseNote,
} from "./core.ts"

type ModelPreference = "auto" | "raw" | `${"opencode" | "opencode-go"}/${string}`

interface BeaconState {
  lastReadByChannel: Record<string, string>
  lastPromptedByChannel: Record<string, string>
  modelPreference: ModelPreference
  summaryCache: Record<string, string>
}

const INITIAL_STATE: BeaconState = {
  lastReadByChannel: {},
  lastPromptedByChannel: {},
  modelPreference: "auto",
  summaryCache: {},
}

function modelKey(model: ModelCandidate): string {
  return `${model.providerID}/${model.id}`
}

function cacheKey(channel: string, notes: ReleaseNote[], model: ModelCandidate): string {
  return `${channel}:${notes[0]?.version ?? "none"}-${notes[notes.length - 1]?.version ?? "none"}:${modelKey(model)}`
}

function channelName(channel: string): string {
  return channel || "unknown"
}

function displayVersion(version: string | undefined): string {
  return version ? `v${version}` : "unknown version"
}

function plainText(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, "")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/__(.*?)__/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 — $2"),
    )
    .join("\n")
}

function sectionColor(line: string, context: Context) {
  const heading = line.trim().toLowerCase()
  if (heading === "main features and behavior changes" || heading === "main features and changes") {
    return context.theme.text.feedback.info.base
  }
  if (heading === "performance and efficiency") return context.theme.text.feedback.success.base
  if (heading === "smaller improvements and fixes") return context.theme.text.feedback.warning.base
  if (heading === "breaking changes or action required" || heading === "breaking changes / action required") {
    return context.theme.text.feedback.error.base
  }
  if (heading === "official release notes") {
    return context.theme.markdown.heading
  }
  if (/^full release notes/.test(heading)) return context.theme.markdown.link
  return undefined
}

function isReleaseVersionLine(line: string): boolean {
  return /^v\d+\.\d+\.\d+(?:\s*·\s*\d{4}-\d{2}-\d{2})?$/.test(line.trim())
}

export default Plugin.define({
  id: "opencode-beacon",
  async setup(context) {
    const [state, updateState] = context.storage.store("state", { initial: INITIAL_STATE })
    let activeDigest: Promise<void> | undefined

    const currentVersion = () => normalizeVersion(context.app.version)
    const channel = channelName(context.app.channel)

    async function availableFreeModels(): Promise<ModelCandidate[]> {
      const location = context.location ?? context.data.location.default()
      const result = await context.client.model.list({
        location: location ? { directory: location.directory } : undefined,
        types: ["chat"],
      })
      return listFreeModels(result.data as ModelCandidate[])
    }

    async function renderDigest(notes: ReleaseNote[]) {
      if (notes.length === 0) {
        await context.ui.dialog.alert({
          title: "OpenCode Beacon",
          message:
            "I couldn't find published release notes for this version range. The update is still pending; try `/beacon` again when GitHub is reachable.",
        })
        return
      }

      const preference = state.modelPreference
      let models: ModelCandidate[] = []
      if (preference !== "raw") {
        try {
          models = await availableFreeModels()
        } catch {
          models = []
        }
      }

      let summary: string | undefined
      let generationFailed = false
      let aiSucceeded = false
      let candidates: ModelCandidate[] = []
      if (preference !== "raw") {
        if (preference === "auto") {
          const first = chooseAutoModel(models)
          candidates = [first, ...models.filter((candidate) => candidate !== first)]
            .filter((candidate): candidate is ModelCandidate => Boolean(candidate))
            .slice(0, 3)
        } else {
          candidates = models.filter((candidate) => modelKey(candidate) === preference)
        }

        for (const model of candidates) {
          const key = cacheKey(channel, notes, model)
          const cached = state.summaryCache[key]
          if (cached) {
            summary = cached
            aiSucceeded = true
            break
          }

          try {
            const response = await context.client.experimental.generate.text({
              model: { providerID: model.providerID, id: model.id },
              prompt: buildSummaryPrompt(notes),
            })
            const text = response.text.trim()
            if (!text) throw new Error("The model returned an empty summary")
            const generated = text
            summary = generated
            aiSucceeded = true
            await updateState((draft) => {
              draft.summaryCache[key] = generated
              const keys = Object.keys(draft.summaryCache)
              for (const oldKey of keys.slice(0, Math.max(0, keys.length - 8))) {
                delete draft.summaryCache[oldKey]
              }
            })
            break
          } catch {
            generationFailed = true
          }
        }
      }

      if (!summary) {
        summary = buildFallbackDigest(notes)
      }
      if (generationFailed && preference !== "raw") {
        context.ui.toast.show({
          title: "Beacon used release notes",
          message: "Free-model attempts were unavailable. Beacon never retries with a paid model.",
          variant: "warning",
        })
      } else if (
        preference !== "raw" &&
        preference !== "auto" &&
        !models.some((candidate) => modelKey(candidate) === preference)
      ) {
        context.ui.toast.show({
          title: "Selected free model unavailable",
          message: "Showing release notes instead. Choose another available free model with `/beacon model`.",
          variant: "warning",
        })
      } else if (!models.length && preference !== "raw") {
        context.ui.toast.show({
          title: "No free model available",
          message: "Showing curated release notes. Choose a free model with `/beacon model`.",
          variant: "info",
        })
      }

      await showDigestDialog(plainText(summary), preference !== "raw", aiSucceeded)
    }

    async function showDigestDialog(content: string, aiEnabled: boolean, aiSucceeded: boolean) {
      context.ui.dialog.set({ size: "xlarge", centered: true })
      const scrollHeight = Math.max(1, Math.min(22, context.renderer.height - 12))
      await new Promise<void>((resolve) => {
        const DialogContent = () => {
          useKeyboard((key) => {
            if (key.name === "escape") context.ui.dialog.clear()
          })

          return (
            <box
              flexDirection="column"
              width="100%"
              padding={1}
              gap={1}
              backgroundColor={context.theme.background.raised.base}
            >
              <box flexDirection="row" justifyContent="space-between" alignItems="center" width="100%">
                <text
                  fg={
                    !aiEnabled
                      ? context.theme.text.muted
                      : aiSucceeded
                        ? context.theme.text.feedback.success.base
                        : context.theme.text.feedback.warning.base
                  }
                  wrapMode="none"
                >
                  {formatAIStatus(aiEnabled, aiSucceeded)}
                </text>
                <text fg={context.theme.text.action.secondary.base} wrapMode="none">
                  <strong>esc</strong>
                </text>
              </box>
              <scrollbox
                height={scrollHeight}
                minHeight={0}
                width="100%"
                focused
                scrollbarOptions={{ visible: false }}
                verticalScrollbarOptions={{ visible: false }}
                horizontalScrollbarOptions={{ visible: false }}
              >
                {content.split("\n").map((line) => {
                  if (!line.trim()) return <box height={1} />
                  if (isReleaseVersionLine(line)) {
                    return (
                      <text fg={context.theme.text.muted} width="100%" textAlign="right" wrapMode="none">
                        {line}
                      </text>
                    )
                  }
                  const color = sectionColor(line, context)
                  return (
                    <text fg={color ?? context.theme.text.base} width="100%" wrapMode="word">
                      {color ? <strong>{line}</strong> : line}
                    </text>
                  )
                })}
              </scrollbox>
              <box flexDirection="row" justifyContent="space-between" width="100%">
                <text fg={context.theme.text.muted} wrapMode="none">
                  /beacon [<strong>model</strong>|<strong>read</strong>|<strong>latest</strong>|<strong>reset</strong>]
                </text>
              </box>
            </box>
          )
        }

        context.ui.dialog.show(() => <DialogContent />, resolve)
      })
    }

    async function showPendingDigest() {
      const current = currentVersion()
      if (!current) {
        context.ui.toast.show({
          title: "OpenCode Beacon",
          message: `Couldn't parse the running version: ${context.app.version}`,
          variant: "warning",
        })
        return
      }

      const previous = state.lastReadByChannel[channel]
      if (previous && compareVersions(current, previous) > 0) {
        const notes = await fetchReleaseRange(previous, current)
        await renderDigest(notes)
        return
      }

      context.ui.toast.show({
        title: "OpenCode Beacon",
        message: `No unread release notes through ${displayVersion(previous ?? current)}. Use /beacon latest to browse the newest release.`,
        variant: "info",
      })
    }

    async function showLatestDigest() {
      const latest = await fetchLatestRelease()
      if (!latest) {
        await context.ui.dialog.alert({
          title: "OpenCode Beacon",
          message: "No stable OpenCode release notes are currently available.",
        })
        return
      }
      await renderDigest([latest])
    }

    async function markCurrentRead() {
      const current = currentVersion()
      if (!current) {
        context.ui.toast.show({
          title: "OpenCode Beacon",
          message: "Couldn't mark notes read because the running version couldn't be parsed.",
          variant: "warning",
        })
        return
      }

      await updateState((draft) => {
        draft.lastReadByChannel[channel] = current
        draft.lastPromptedByChannel[channel] = current
      })
      context.ui.toast.show({
        title: "OpenCode Beacon",
        message: `Release notes marked read through ${displayVersion(current)}.`,
        variant: "success",
      })
    }

    async function resetBeacon() {
      const current = currentVersion()
      const confirmed = await context.ui.dialog.confirm({
        title: "Reset OpenCode Beacon?",
        message: [
          "This clears Beacon's cached summaries, read/prompt tracking, and selected model.",
          current
            ? `Tracking will restart from ${displayVersion(current)}.`
            : "Tracking will restart the next time Beacon can read the running version.",
          "OpenCode sessions, credentials, and other application data are not affected.",
        ].join("\n\n"),
        label: { confirm: "Reset Beacon", cancel: "Cancel" },
      })
      if (confirmed !== true) return

      await updateState((draft) => {
        draft.lastReadByChannel = current ? { [channel]: current } : {}
        draft.lastPromptedByChannel = {}
        draft.modelPreference = "auto"
        draft.summaryCache = {}
      })
      context.ui.toast.show({
        title: "OpenCode Beacon reset",
        message: current
          ? `Beacon is tracking from ${displayVersion(current)} with Auto summaries.`
          : "Beacon data was cleared. Tracking will initialize at the next launch.",
        variant: "success",
      })
    }

    async function chooseModel() {
      let models: ModelCandidate[] = []
      try {
        models = await availableFreeModels()
      } catch {
        context.ui.toast.show({
          title: "OpenCode Beacon",
          message: "Couldn't load the available models. Auto and release-notes-only options remain available.",
          variant: "warning",
        })
      }

      const options = [
        {
          title: "Auto (recommended)",
          value: "auto" as const,
          description: "Choose a preferred, available OpenCode model whose listed prices are all zero.",
          category: "Free summaries",
        },
        {
          title: "Release notes only",
          value: "raw" as const,
          description: "No model request; show the categorized official notes.",
          category: "No AI",
        },
        ...models.map((model) => ({
          title: model.name,
          value: modelKey(model) as ModelPreference,
          description: `${model.providerID === "opencode-go" ? "OpenCode Go" : "OpenCode"} · zero listed cost · ${Math.round((model.limit?.context ?? 0) / 1000)}K context · provider data terms may differ`,
          category: "Available free models",
        })),
      ]

      const selected = await context.ui.dialog.select<ModelPreference>({
        title: "Choose Beacon's summary model",
        current: state.modelPreference,
        options,
      })
      if (!selected) return

      await updateState((draft) => {
        draft.modelPreference = selected
      })
      context.ui.toast.show({
        title: "OpenCode Beacon",
        message:
          selected === "auto"
            ? "Auto will choose from available zero-cost OpenCode models."
            : selected === "raw"
              ? "AI summaries are off; Beacon will show release notes directly."
              : `Summary model set to ${models.find((model) => modelKey(model) === selected)?.name ?? selected}.`,
        variant: "success",
      })
    }

    async function openDigest() {
      return openDigestWith(showPendingDigest)
    }

    async function openLatestDigest() {
      return openDigestWith(showLatestDigest)
    }

    async function openDigestWith(action: () => Promise<void>) {
      if (activeDigest) return activeDigest
      activeDigest = action().finally(() => {
        activeDigest = undefined
      })
      return activeDigest
    }

    async function runCommand(input = "") {
      const command = input.trim().split(/\s+/, 1)[0]?.toLowerCase()
      if (command === "read") {
        await markCurrentRead()
        return
      }
      if (command === "model" || command === "models") {
        await chooseModel()
        return
      }
      if (command === "reset") {
        await resetBeacon()
        return
      }

      try {
        await (command === "latest" ? openLatestDigest() : openDigest())
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        context.ui.toast.show({
          title: "OpenCode Beacon couldn't load release notes",
          message: `${message}. The unread version range is preserved; retry with /beacon.`,
          variant: "error",
        })
      }
    }

    context.keymap.layer(() => ({
      mode: "global",
      priority: 20,
      commands: [
        {
          id: "opencode-beacon.open",
          title: "Open release digest",
          description: "Review OpenCode release notes and skipped versions",
          group: "OpenCode Beacon",
          palette: true,
          slash: { name: "beacon", aliases: ["whatsnew", "whats-new"], arguments: true },
          run: runCommand,
        },
        {
          id: "opencode-beacon.model",
          title: "Choose Beacon summary model",
          description: "Select Auto, a free OpenCode model, or release notes only",
          group: "OpenCode Beacon",
          palette: true,
          run: chooseModel,
        },
        {
          id: "opencode-beacon.latest",
          title: "Browse latest OpenCode release",
          group: "OpenCode Beacon",
          palette: true,
          run: () => runCommand("latest"),
        },
        {
          id: "opencode-beacon.reset",
          title: "Reset Beacon data",
          description: "Clear Beacon's cache, read state, and model selection",
          group: "OpenCode Beacon",
          palette: true,
          run: resetBeacon,
        },
        {
          id: "opencode-beacon.read",
          title: "Mark Beacon releases as read",
          group: "OpenCode Beacon",
          palette: true,
          run: markCurrentRead,
        },
      ],
      bindings: [
        "opencode-beacon.open",
        "opencode-beacon.model",
        "opencode-beacon.latest",
        "opencode-beacon.reset",
        "opencode-beacon.read",
      ],
    }))

    const runningVersion = currentVersion()
    if (context.app.channel !== "prod" || !runningVersion) return

    const previousRead = state.lastReadByChannel[channel]
    if (!previousRead) {
      await updateState((draft) => {
        draft.lastReadByChannel[channel] = runningVersion
        draft.lastPromptedByChannel[channel] = runningVersion
      })
      context.ui.toast.show({
        title: "OpenCode Beacon is ready",
        message: "Release digests will appear after an OpenCode update. Use /beacon to browse release notes.",
        variant: "info",
      })
      return
    }

    if (
      compareVersions(runningVersion, previousRead) > 0 &&
      state.lastPromptedByChannel[channel] !== runningVersion
    ) {
      context.ui.toast.show({
        title: `OpenCode updated to ${displayVersion(runningVersion)}`,
        message: "Preparing your release digest…",
        variant: "info",
      })
      try {
        await openDigest()
        await updateState((draft) => {
          draft.lastPromptedByChannel[channel] = runningVersion
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        context.ui.toast.show({
          title: "OpenCode Beacon couldn't load release notes",
          message: `${message}. The unread version range is preserved; retry with /beacon.`,
          variant: "error",
        })
      }
    }
  },
})
