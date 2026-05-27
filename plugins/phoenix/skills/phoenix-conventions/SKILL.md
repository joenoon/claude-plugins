---
name: phoenix-conventions
description: Use when working in a Phoenix/Elixir codebase — building features, reviewing router/auth/LiveView/Ecto/Oban code, configuring or deploying. Provides opinionated conventions for runtime config, auth, LiveView state and async, forms (changeset-backed), Ecto, Oban (snooze/kickoff), Req HTTP, testing, Fly deployment, and CI/CD via GitHub Actions.
---

# Phoenix conventions

Opinions distilled from production Phoenix 1.7 / LiveView 1.1 / Elixir 1.19 / OTP 27 apps on Fly. Assumes you already know Phoenix — this skill surfaces *opinions and best practices*, not framework basics.

## How to apply these conventions

These are *recommendations* distilled from production work, not laws.
**User preferences win** — if the project already does things
differently, or the user explicitly asks for a different approach,
follow the user, not this skill. Use these as defaults for fresh code;
when editing existing code, match what's there. Don't refactor away
from convention-violating patterns just because they violate
convention — the user may have chosen them deliberately.

## Guiding philosophy

- **Boring stack, opinionated assembly.** Stock Phoenix + LiveView + Ecto + Oban + Req. No exotic libraries. Opinions show up in wiring, not in what's chosen.
- **Loose version pins.** `~> 1.7` floors, not `1.7.2` exact pins. Local + prod can be ahead of mix.exs floor.
- **Runtime over compile-time.** Config loaded at boot from env vars (`runtime.exs`). Build doesn't bake secrets or hostnames.
- **Auth is a routing concern**, not a per-LV concern. Three `live_session` tiers (public / authed / admin) gate everything. No middleware-style guards in individual LiveViews.
- **Form inputs go through a changeset.** Use Ecto `embedded_schema` changesets for non-persisted forms (search filters, modal forms, command intents) so they get the same validation/casting/error display as schema-backed forms. Plain `to_form(%{}, as: :key)` only for truly validation-free inputs.
- **Async with explicit state.** Default to `assign_async/3`; reach for `start_async/3` + `handle_async/3` only when you need custom result handling. Render all three states explicitly via `<.async_result>` or direct field access (`@x.loading`, `@x.ok?`, `@x.result`) — loading is a UI state, not absence of UI.
- **Minimal tooling.** `.formatter.exs` with the LiveView HTML formatter plugin is the only code-quality config. No Credo, no Dialyzer until the project actually needs them — they amplify trivial bikeshedding early on.

## When to load which reference

Load only what you need for the current task. Each reference is focused.

| Reference | Load when... |
|-----------|--------------|
| [`config.md`](references/config.md) | Touching `config/*.exs` — `runtime.exs`, `dev.exs` live_reload, `check_origin` |
| [`router-and-auth.md`](references/router-and-auth.md) | Adding routes, gating access, working on login/logout, admin tooling |
| [`liveview-idioms.md`](references/liveview-idioms.md) | Writing or modifying a LiveView — async, PubSub, forms, dedup, password manager |
| [`ecto-and-contexts.md`](references/ecto-and-contexts.md) | Schemas, migrations, soft-delete, contexts |
| [`oban.md`](references/oban.md) | Background jobs, snooze loops, kickoff, ping! pattern |
| [`req-http.md`](references/req-http.md) | Calling any external HTTP API |
| [`testing.md`](references/testing.md) | Writing tests — ConnCase, DataCase, SQL Sandbox, HTTP stubbing |
| [`deployment-fly.md`](references/deployment-fly.md) | Fly config, Dockerfile, releases, IPv6, clustering; includes template files in `references/deployment-fly/` |
| [`ci-cd.md`](references/ci-cd.md) | GitHub Actions preview-apps + release workflow; includes templates in `references/ci-cd/` |

## Words to avoid

In code, docs, commits, UI copy: `load-bearing`, `substrate`, `wedge`,
`seam`, `vestigial`, `tapestry`, `delve`. `seam` is banned but
`seamless` is fine. If you reach for one of these, the idea usually
has a more concrete name — say what the thing does instead of
nominating it as architectural.
