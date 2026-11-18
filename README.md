# OpenCode Beacon

OpenCode Beacon is a TUI plugin that catches you up on OpenCode releases after
an update, including versions you skipped. It fetches public GitHub release
notes, offers an AI digest using only confirmed zero-cost OpenCode models, and
falls back to curated release notes if no free model is available.

## Features

- Shows a digest the first time the TUI starts on a newer stable release.
- Includes every stable release between the last version you marked read and
  the version currently running.
- Orders releases newest first by publication date, using descending version
  number when dates tie or are unavailable.
- Highlights major changes, efficiency improvements, smaller improvements,
  fixes, and breaking changes separately.
- Uses theme-aware colors to distinguish sections, with a centered, wide,
  scrollable digest dialog, with AI status on the left and `esc` on the right
  of the top row.
- `/beacon` reopens the pending digest.
- `/beacon read` marks the current release range as read.
- `/beacon model` chooses Auto, a currently available free OpenCode model, or
  release-notes-only mode.
- The dialog's AI status follows this setting: Auto and a selected free model
  show `AI on (success)` when a generated or cached summary is used and
  `AI on (failure)` when generation fails; release-notes-only shows `AI off`.
- Auto tries up to three available zero-cost models in preference order; if all
  fail, Beacon shows the curated notes.
- Never sends release notes to a model with non-zero or unknown pricing.
- Never sends project files, prompts, or session history to a model.

## Requirements

- OpenCode 2.3.0 or later.
- A connected OpenCode provider account with at least one available model whose
  listed input, output, and cache prices are all zero to use AI summaries.
- Zero-cost models from either `opencode` or `opencode-go` are eligible; when
  available, OpenCode Go free models are preferred.
- Network access to GitHub for release notes. Offline, Beacon keeps the pending
  update; retry with `/beacon` when connectivity returns.

Free model availability, usage limits, region restrictions, and data policies
can change. The model picker uses the live OpenCode catalog and displays the
models currently available to your account.

## Install locally

From this directory:

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

## Commands

- `/beacon` — open the pending digest; after marking it read, it reports that
  there are no unread notes.
- `/beacon latest` — browse the newest published stable release without changing
  the read-through version.
- `/beacon read` — mark all releases through the running version as read.
- `/beacon model` — choose Auto, an available free model, or no AI.
- `/beacon reset` — after confirmation, clear Beacon's cached summaries,
  read/prompt tracking, and model selection. Tracking restarts from the running
  version; OpenCode sessions, credentials, and other application data are untouched.

The first launch after installing Beacon records the current version as the
starting point. It does not surprise you with old release notes; the first
automatic digest appears after a later OpenCode update.
