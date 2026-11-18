# OpenCode Beacon

Catch up on OpenCode releases after an update, including versions you skipped.
Beacon can summarize the release range with a zero-cost OpenCode model, or show
curated release notes directly.

> A quick disclosure: Beacon was built with AI-assisted coding.

## Features

- Shows a digest on the first launch after a newer stable OpenCode release.
- Includes every stable release since the last version you marked read.
- Orders releases newest-first by publication date, then descending version.
- Groups changes into features, efficiency improvements, smaller fixes, and
  breaking changes, with theme-aware section colors.
- Shows a scrollable digest with `esc` and an AI status:
  `AI off`, `AI on (success)`, or `AI on (failure)`.
- Displays an animated progress window while an AI summary is generated.
- Uses only zero-cost `opencode` or `opencode-go` models. It never retries with
  a paid model and never sends project files, prompts, or session history.
- Falls back to curated release notes when no free model is available.

The first launch establishes a baseline. It does not show old releases before
that point.

## Commands

| Command | Purpose |
| --- | --- |
| `/beacon` | Open the pending digest. Reports when there are no unread releases. |
| `/beacon latest` | Browse the newest stable release without changing read status. |
| `/beacon read` | Mark everything through the running version as read. |
| `/beacon model` | Choose Auto, an available free model, or release-notes-only mode. |
| `/beacon reset` | Clear Beacon's cache, read/prompt tracking, and model choice after confirmation. |

`/beacon reset` restarts tracking from the running version. It does not touch
OpenCode sessions, credentials, or other application data.

## Install

Requires OpenCode 2.3.0 or later and network access to GitHub for release notes.

```sh
npm install
```

Add the absolute path to this directory to the `plugins` array in your global
`~/.config/opencode/cli.json` (or `$XDG_CONFIG_HOME/opencode/cli.json`):

```json
{
  "plugins": ["/absolute/path/to/opencode-beacon"]
}
```

Keep any existing CLI settings in that file. OpenCode reloads `cli.json` while
running; use `/reload` if needed.

## AI summaries

Auto tries up to three available zero-cost models, preferring OpenCode Go free
models. A cached summary is reused for the same release range and model.

AI status reflects the current setting and result:

| Status | Meaning |
| --- | --- |
| `AI off` | Release-notes-only mode. |
| `AI on (success)` | A generated or cached AI summary is shown. |
| `AI on (failure)` | All free-model attempts failed; curated notes are shown. |

Free-model availability, quotas, regions, and provider data policies can change.
The model picker uses the live OpenCode catalog. Only the public release notes
are sent to the selected model.
