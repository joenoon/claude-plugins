# Claude plugins marketplace — design

**Date:** 2026-05-27
**Author:** Joe Noon (with Claude)
**Status:** Approved (phase 1 only)

## Goal

Turn `/home/sprite/phx-skill` into a public Claude Code plugin marketplace at
`github.com/joenoon/claude-plugins`. The marketplace ships reusable conventions
and skills that can be picked à la carte per project. The first plugin is
`phoenix` — opinionated patterns for Phoenix/LiveView/Ecto apps. The repo is
designed to grow more plugins over time.

This spec covers **phase 1 only: the marketplace skeleton.** The actual
phoenix-conventions content (slicing `PHOENIX_PROJECT_SKILL.md` into
`references/`) is intentionally deferred to a separate phase so it can be
iterated on editorially.

## Non-goals (phase 1)

- Populating any reference content. The phoenix-conventions skill ships with
  philosophy + an empty references index in phase 1.
- Adding any second plugin.
- Commands, agents, hooks, MCP servers — none in v0.1.0.
- Cutting a v0.1.0 git tag / GitHub release — defer until phase 2 lands real
  content. The `version` field in `marketplace.json` and `plugin.json` is
  pre-set to `0.1.0` (what it will be tagged at), but no tag is created yet.

## Distribution model

- Public GitHub repo: `joenoon/claude-plugins`.
- Marketplace identifier (inside Claude UI): `joenoon` — set as the `name`
  field in `marketplace.json`.
- Install UX:
  - `/plugin marketplace add joenoon/claude-plugins`
  - `/plugin install phoenix@joenoon`
- Per-project enablement via the project's `.claude/settings.json`
  (`enabledPlugins`), so different projects pick different plugins.

## Repo layout

Local dir stays `/home/sprite/phx-skill` (no rename). Remote becomes
`joenoon/claude-plugins`.

```
phx-skill/                                  # local; remote = joenoon/claude-plugins
├── .claude-plugin/
│   └── marketplace.json
├── plugins/
│   └── phoenix/
│       ├── .claude-plugin/
│       │   └── plugin.json
│       └── skills/
│           └── phoenix-conventions/
│               ├── SKILL.md                # philosophy + empty references index
│               └── references/
│                   └── .gitkeep            # placeholder; real files in phase 2
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-05-27-claude-plugins-marketplace-design.md  # this file
├── PHOENIX_PROJECT_SKILL.md                # working source; sliced up in phase 2
├── README.md
├── LICENSE                                 # MIT
└── .gitignore
```

`PHOENIX_PROJECT_SKILL.md` stays at the root through phase 1 as the working
source material. Phase 2 slices it into `references/*.md` files and removes it.

## File contents

### `.claude-plugin/marketplace.json`

```json
{
  "name": "joenoon",
  "owner": {
    "name": "Joe Noon",
    "url": "https://github.com/joenoon/claude-plugins"
  },
  "metadata": {
    "description": "Joe Noon's reusable Claude Code plugins — conventions, skills, and tools.",
    "version": "0.1.0"
  },
  "plugins": [
    {
      "name": "phoenix",
      "source": "./plugins/phoenix",
      "description": "Opinionated patterns for Phoenix/LiveView/Ecto apps deployed on Fly.",
      "category": "framework",
      "tags": ["phoenix", "elixir", "liveview", "ecto", "fly"]
    }
  ]
}
```

### `plugins/phoenix/.claude-plugin/plugin.json`

```json
{
  "name": "phoenix",
  "version": "0.1.0",
  "description": "Opinionated Phoenix/LiveView/Ecto/Oban conventions distilled from a production app.",
  "author": {
    "name": "Joe Noon",
    "url": "https://github.com/joenoon/claude-plugins"
  },
  "license": "MIT",
  "keywords": ["phoenix", "elixir", "liveview", "ecto", "oban", "fly"]
}
```

No `commands`, `agents`, `hooks`, or `mcpServers` fields. Claude auto-discovers
`skills/*/SKILL.md`.

### `plugins/phoenix/skills/phoenix-conventions/SKILL.md`

```markdown
---
name: phoenix-conventions
description: Use when working in a Phoenix/Elixir codebase — building new
  features, scaffolding a new Phoenix app, reviewing router/auth/LiveView/Ecto/
  Oban code, or deploying to Fly. Provides opinionated patterns for project
  structure, runtime config, auth, LiveView state, Ecto, Oban, Req HTTP,
  testing, and CI/CD.
---

# Phoenix conventions

Opinionated patterns for Phoenix 1.7 / LiveView 1.1 / Elixir 1.19 / OTP 27
apps on Fly. References are added in phase 2.

## Guiding philosophy

(Placeholder for phase 2 — pulled from PHOENIX_PROJECT_SKILL.md.)

## References

(Phase 2: an index of references/*.md files goes here.)
```

The SKILL.md is intentionally minimal in phase 1. It has valid frontmatter so
the skill registers, but the body is a placeholder until phase 2 fills it in.

### `plugins/phoenix/skills/phoenix-conventions/references/.gitkeep`

Empty file. Keeps the `references/` directory in git.

### `README.md`

```markdown
# joenoon/claude-plugins

Joe Noon's reusable Claude Code plugins.

## Install

    /plugin marketplace add joenoon/claude-plugins
    /plugin install <plugin-name>@joenoon

## Plugins

| Plugin | Description |
|--------|-------------|
| [`phoenix`](plugins/phoenix) | Opinionated patterns for Phoenix/LiveView/Ecto apps on Fly |

(More to come.)

## Per-project enabling

Add to your project's `.claude/settings.json`:

    {
      "enabledPlugins": { "phoenix@joenoon": true }
    }

So you can keep different plugins enabled per project.

## Adding a new plugin

1. Create `plugins/<name>/.claude-plugin/plugin.json`
2. Add skills under `plugins/<name>/skills/<skill-name>/SKILL.md`
3. Register it in `.claude-plugin/marketplace.json`
```

### `LICENSE`

Standard MIT, copyright Joe Noon, 2026.

### `.gitignore`

```
.DS_Store
*.swp
```

## Verification

Phase 1 is verified by:

1. `marketplace.json` and `plugin.json` parse as valid JSON.
2. Local install works: from another directory, run
   `/plugin marketplace add /home/sprite/phx-skill` followed by
   `/plugin install phoenix@joenoon` — the `phoenix-conventions` skill should
   appear in the skill list.
3. After pushing to `joenoon/claude-plugins`, the GitHub install path works:
   `/plugin marketplace add joenoon/claude-plugins` succeeds and the same
   install command completes.

The skill having minimal content is fine for verification — we're testing that
the marketplace plumbing is correct, not the content.

## Out-of-scope notes (for context, not for phase 1)

**Phase 2 (deferred):** Slice `PHOENIX_PROJECT_SKILL.md` into
`references/project-structure.md`, `config.md`, `router-and-auth.md`,
`liveview-idioms.md`, `components-and-assets.md`, `ecto-and-contexts.md`,
`oban.md`, `req-http.md`, `testing.md`, `deployment-fly.md`, `ci-cd.md`,
`pubsub.md`, `process-docs.md`, `day-one-checklist.md`. Each section gets
reviewed/edited by Joe before landing. The SKILL.md index table is filled in
as references come online. `PHOENIX_PROJECT_SKILL.md` is deleted once
everything's migrated. Tag v0.1.0 at the end of phase 2.

**Future plugins:** The marketplace is sized for multiple plugins. New plugins
follow the same `plugins/<name>/` shape and get a new entry in
`marketplace.json`.
