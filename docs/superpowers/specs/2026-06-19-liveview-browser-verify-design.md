# liveview-browser-verify skill — design

**Date:** 2026-06-19
**Author:** Joe Noon (with Claude)
**Status:** Approved (design)

## Goal

Add a second skill to the `phoenix` plugin: `liveview-browser-verify`. It lets
the agent *render and look at* a real LiveView page in a headless browser —
optionally logged in — so a UI change is verified end-to-end, not just covered
by ExUnit + Floki (which only assert server-rendered HTML, never the live
JS-connected app).

The skill is distilled from Podclave's `bin/browser/` tooling, which has proven
itself in day-to-day work. This generalizes the ~90% that is reusable and drops
the Podclave-specific parts.

## Why this is its own skill (not part of phoenix-conventions)

`phoenix-conventions` triggers while *writing* Phoenix code. Browser-verify
triggers at a different moment — *after* a change, when you want to confirm the
JS-connected UI actually renders. A separate skill with its own description
activates at the right time.

## Scope: general mechanism, LiveView profile

The screenshot mechanism (launch Chromium, optional login, goto a path, settle,
full-page screenshot, report `url/status/title/text`) is framework-agnostic. The
**single** LiveView-specific line is the success probe:

```js
window.liveSocket && window.liveSocket.isConnected()
```

That is one instance of a general idea — "did the JS app come alive?" The script
keeps `liveSocket` as the default probe with a clearly-marked comment showing
which line to swap for a React/htmx app. We do **not** ship React/htmx profile
files — there is no non-Phoenix app to serve today (YAGNI). The generic core is
written cleanly so the whole skill is liftable into its own plugin later if that
changes.

## Agent-driven, not a human checklist

This is the central design decision. The SKILL.md is written as instructions to
the **agent**, not a to-do list for the user. When the user says "verify this
change," the agent does the whole bootstrap itself:

1. **Ensure the harness exists.** If `bin/browser/shot.mjs` is absent in the
   target project, copy `references/browser/{shot.mjs,setup.sh,package.json}`
   from the skill directory into the project's `bin/browser/`, and add
   `node_modules/`, `shots/`, `package-lock.json` to `bin/browser/.gitignore`.
2. **Ensure deps are installed.** If `bin/browser/node_modules` is missing, run
   `bin/browser/setup.sh` (Playwright + Chromium + `install-deps`).
3. **Ensure the dev-login backdoor exists.** If the project has no dev-gated
   login route, add one (or offer to) — `GET /dev/login?email=`, compile-gated
   to dev only. This is the one piece that touches app code.
4. **Run the shot** for the path(s) under test, with `--auth`/`--mobile` as
   needed.
5. **Read the screenshot** and the printed `liveViewConnected` signal, and
   report what was seen.

The user never sees the plumbing unless a step needs their decision (e.g.
adding a route to their app).

## Files

```
plugins/phoenix/skills/liveview-browser-verify/
  SKILL.md
  references/browser/
    shot.mjs        # generic render+screenshot core + liveSocket probe
    setup.sh        # playwright + chromium + install-deps
    package.json    # playwright dep (name: phoenix-browser-tools)
```

### shot.mjs — changes from Podclave's copy

The script is already clean; changes are minimal:

- Add `AUTH_PATH` env (default `/dev/login?email=`) so the dev-login route is
  overridable per project.
- Drop Podclave/Sprite-specific defaults and comments (e.g. the Sprites-API
  `WAIT` note, `browsertest@example.com` default email).
- Keep `BASE` / `AUTH_EMAIL` / `WAIT` envs.
- Keep `liveSocket.isConnected()` as the probe, with a `// swap this line for a
  non-LiveView app's hydration check` comment.

### setup.sh

Generalized verbatim from Podclave's: `npm install`, `playwright install
chromium`, `sudo env "PATH=$PATH" ... install-deps chromium` (the `sudo env`
PATH gotcha is kept — it bites on any Debian-family box).

### package.json

`name: phoenix-browser-tools`, `private: true`, `type: module`, dep
`playwright: ^1.60.0`.

## SKILL.md content (the real payload)

Frontmatter description triggers on: verifying / seeing a LiveView (or
JS-dependent) UI change in a real browser; "did it actually render?"; the fact
that ExUnit + Floki only check server HTML.

Body sections:

- **Why** — Floki ≠ the live app; `liveViewConnected: true` is the success
  signal.
- **Bootstrap** — the agent-driven checklist above (steps 1–5), written as
  agent instructions.
- **Usage** — `node bin/browser/shot.mjs <path> [--auth] [--mobile]`; how to
  read the output.
- **The dev-login backdoor** — what to add and why (email-code login is
  rate-limited ~5/hr; dev-gate the route).
- **Gotchas** — worktree `node_modules` link missing → `app.js` 404 →
  `liveViewConnected: false`; auth'd/server-roundtrip pages cost real work, run
  them when the verification earns it.
- **Generic-core note** — everything except the `liveSocket` line is
  framework-agnostic; here is the line to swap.

## Non-goals

- Rewiring Podclave's own `bin/browser/` to consume this skill. Podclave's copy
  stays as-is (it carries Sprite-specific `WAIT` gotchas the generic skill
  drops). Pulling Podclave from the skill is a separate, later concern — one
  concern per change.
- React/htmx/Vue profile files. Just the swap-this comment until there is a
  non-Phoenix app.
- A Playwright `storageState` session-reuse mechanism (Podclave's README lists
  it as a TODO). Out of scope here; the dev-login backdoor is enough.
- Cutting a new plugin version tag.

## Open questions

None blocking. The dev-login route's exact shape is left to the agent to match
the target app's auth (it reads the project's router/auth before adding).
