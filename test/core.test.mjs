import assert from "node:assert/strict"
import test from "node:test"
import {
  buildFallbackDigest,
  chooseAutoModel,
  compareVersions,
  fetchReleaseRange,
  formatAIStatus,
  isZeroCostModel,
  listFreeModels,
  normalizeVersion,
  releaseIsOptimization,
  releaseToNote,
  sortReleaseNotesNewestFirst,
} from "../src/core.ts"

const freeModel = (id, overrides = {}) => ({
  id,
  providerID: "opencode",
  name: id,
  enabled: true,
  status: "active",
  cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
  ...overrides,
})

test("normalizes and compares stable versions", () => {
  assert.equal(normalizeVersion("v2.3.0"), "2.3.0")
  assert.equal(normalizeVersion("2.3.0-beta.1"), "2.3.0")
  assert.equal(normalizeVersion("local-build"), undefined)
  assert.equal(compareVersions("2.3.0", "2.2.9"), 1)
  assert.equal(compareVersions("v2.3.0", "2.3.0"), 0)
  assert.equal(compareVersions("2.3.0", "2.3.1"), -1)
})

test("AI indicator reflects configured mode and summary result", () => {
  assert.equal(formatAIStatus(false, false), "AI off")
  assert.equal(formatAIStatus(true, true), "AI on (success)")
  assert.equal(formatAIStatus(true, false), "AI on (failure)")
})

test("only known zero-cost OpenCode chat models are eligible", () => {
  assert.equal(isZeroCostModel(freeModel("deepseek-v4.1-flash-free")), true)
  assert.equal(isZeroCostModel(freeModel("paid", { cost: [{ input: 0, output: 0.01, cache: { read: 0, write: 0 } }] })), false)
  assert.equal(isZeroCostModel(freeModel("unknown", { cost: [{ input: 0, output: 0 }] })), false)
  assert.equal(isZeroCostModel(freeModel("other-provider", { providerID: "openrouter" })), false)
  assert.equal(isZeroCostModel(freeModel("disabled", { enabled: false })), false)
})

test("Auto picks the preferred free model and excludes paid candidates", () => {
  const models = [
    freeModel("unranked-latest", { time: { released: 999 } }),
    freeModel("mimo-v2.6-flash-free"),
    freeModel("deepseek-v4.1-flash-free"),
    freeModel("paid", { cost: [{ input: 1, output: 1, cache: { read: 0, write: 0 } }] }),
  ]

  assert.equal(chooseAutoModel(models)?.id, "deepseek-v4.1-flash-free")
  assert.deepEqual(
    listFreeModels(models).map((model) => model.id),
    ["deepseek-v4.1-flash-free", "mimo-v2.6-flash-free", "unranked-latest"],
  )
})

test("parses release categories and separates performance optimizations", () => {
  const note = releaseToNote({
    tag_name: "v2.4.0",
    name: "Beacon test release",
    html_url: "https://github.com/anomalyco/opencode/releases/tag/v2.4.0",
    published_at: "2026-11-18T00:00:00Z",
    body: [
      "### Highlights",
      "- Added background summaries.",
      "### Core",
      "#### Improvements",
      "- Faster startup and lower memory use.",
      "#### Bug fixes",
      "- Fixed a display issue.",
      "### Breaking changes",
      "- Renamed a configuration key.",
    ].join("\n"),
  })

  assert.ok(note)
  assert.deepEqual(note.highlights, ["Added background summaries."])
  assert.deepEqual(note.improvements, ["Faster startup and lower memory use."])
  assert.deepEqual(note.fixes, ["Fixed a display issue."])
  assert.deepEqual(note.breaking, ["Renamed a configuration key."])
  assert.equal(releaseIsOptimization(note.improvements[0]), true)
})

test("orders releases by published date, then descending version", () => {
  const releases = [
    { tag_name: "v2.4.0", html_url: "https://example.test/2.4.0", published_at: "2026-11-16T10:00:00Z" },
    { tag_name: "v2.3.2", html_url: "https://example.test/2.3.2", published_at: "2026-11-17T09:00:00Z" },
    { tag_name: "v2.3.3", html_url: "https://example.test/2.3.3", published_at: "2026-11-17T08:00:00Z" },
  ]
  const notes = releases.map(releaseToNote)

  assert.deepEqual(
    sortReleaseNotesNewestFirst(notes).map((note) => note.version),
    ["2.3.3", "2.3.2", "2.4.0"],
  )
})

test("fallback digest includes categories and release versions without boilerplate", () => {
  const note = releaseToNote({
    tag_name: "v2.4.0",
    name: "Beacon test release",
    html_url: "https://github.com/anomalyco/opencode/releases/tag/v2.4.0",
    body: "### Highlights\n- Added background summaries.\n### Improvements\n- Faster startup.",
  })
  const digest = buildFallbackDigest([note])

  assert.match(digest, /Main features and changes/)
  assert.match(digest, /Performance and efficiency/)
  assert.doesNotMatch(digest, /Full release notes/)
  assert.match(digest, /v2\.4\.0/)
})

test("release lookup includes every stable version in range and excludes newer or prerelease tags", async () => {
  const releases = [
    { tag_name: "v2.4.0", html_url: "https://example.test/2.4.0", body: "### Highlights\n- Newer." },
    { tag_name: "v2.3.3-rc.1", prerelease: true, html_url: "https://example.test/rc", body: "Preview." },
    {
      tag_name: "v2.3.2",
      html_url: "https://example.test/2.3.2",
      published_at: "2026-11-17T00:00:00Z",
      body: "### Highlights\n- Second.",
    },
    {
      tag_name: "v2.3.1",
      html_url: "https://example.test/2.3.1",
      published_at: "2026-11-18T00:00:00Z",
      body: "### Highlights\n- First.",
    },
    { tag_name: "v2.3.0", html_url: "https://example.test/2.3.0", body: "### Highlights\n- Baseline." },
  ]
  const fetcher = async () => new Response(JSON.stringify(releases), { status: 200 })
  const notes = await fetchReleaseRange("2.3.0", "2.3.2", fetcher)

  assert.deepEqual(notes.map((note) => note.version), ["2.3.1", "2.3.2"])
})
