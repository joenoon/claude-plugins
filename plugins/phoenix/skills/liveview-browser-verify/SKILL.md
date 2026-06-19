---
name: liveview-browser-verify
description: Use after changing a LiveView (or any JS-dependent) UI to verify it actually renders in a real browser — ExUnit + Floki only assert server-rendered HTML, never the live JS-connected app. Renders a path in headless Chromium, optionally logged in, checks liveSocket connectivity, and screenshots it so you can see the change. The skill bootstraps the harness into the project itself.
---

# LiveView browser-verify

Render a real LiveView page in headless Chromium and *look* at it, so a UI
change is verified end-to-end — not just covered by ExUnit + Floki. Floki
asserts on server-rendered HTML; this renders the actual app with LiveView's
JS websocket connected. `liveViewConnected: true` in the output is the success
signal: the page mounted and the socket is live.

## When to use this

- After a LiveView/HEEx change you want to *see* rendered, not just unit-test.
- To check a responsive layout (`--mobile`).
- To confirm an authenticated page renders for a given user.

Read-only public renders are cheap — run them freely. Authenticated or
server-roundtrip-heavy pages cost real work (DB, external APIs); run those when
the verification earns it.

## Bootstrap (do this for the user, silently)

When asked to browser-verify, ensure the harness is present in the project,
then run it. Do NOT hand the user a checklist — perform these yourself.

1. **Harness files.** If `bin/browser/shot.mjs` does not exist in the project,
   copy all four template files from this skill's `references/browser/`
   directory into the project's `bin/browser/`:
   `shot.mjs`, `setup.sh`, `package.json`, `.gitignore`. (`chmod +x
   bin/browser/setup.sh`.)
2. **Dependencies.** If `bin/browser/node_modules` is missing, run
   `bin/browser/setup.sh` (Playwright + Chromium + apt `install-deps`).
   Chromium is cached in `~/.cache/ms-playwright` and shared across projects,
   so this is a one-time cost per machine.
3. **Dev-login route.** If `--auth` is needed and the project has no dev-gated
   login backdoor, add one (see below) — or, if you cannot safely edit the
   router, tell the user the one route to add and why.
4. **Run the shot** for the path(s) under test.
5. **Read the screenshot** (`bin/browser/shots/<name>.png`) and report what you
   see, plus the `liveViewConnected` / `status` lines.

## Usage

Dev server must be running (e.g. `PORT=8080 mix phx.server`).

```
node bin/browser/shot.mjs <path> [--auth] [--mobile] [--name foo]
```

- `--auth` logs in first via the dev-login backdoor.
- `--mobile` uses a 390px viewport.
- `--name` sets the screenshot basename (default derived from the path).

Env: `BASE` (default `http://127.0.0.1:8080`), `AUTH_PATH` (dev-login route
prefix, default `/dev/login?email=`), `AUTH_EMAIL` (who to log in as), `WAIT`
(settle ms, default `1500`; raise it for pages with slow server-side data).

Output: `url / status / liveViewConnected / title / text` plus a full-page PNG
in `bin/browser/shots/` (gitignored).

## The dev-login backdoor

The normal email-code login is rate-limited (typically a few codes per hour per
email), so re-logging-in on every render trips the limit. Instead, add a
dev-only route that sets the session directly. Compile-gate it to dev so it
never ships to prod — in a Phoenix router:

```elixir
if Application.compile_env(:my_app, :dev_routes) do
  scope "/dev" do
    pipe_through :browser
    get "/login", MyAppWeb.DevLoginController, :create
  end
end
```

The controller looks up (or creates) the user by the `email` query param, puts
the same session the real login flow does, and redirects to `/`. Match the
project's actual auth — read its existing login controller/plug first.

## Gotchas

- **`liveViewConnected: false` with `/assets/app.js` 404** — the JS bundle did
  not load, so LiveView never connected. In a git-worktree setup this usually
  means the worktree's `assets/node_modules` link is missing and esbuild can't
  resolve deps; restore the project's worktree asset linking and retry.
- **Run the script from wherever Playwright is installed** — it only talks to
  the server at `BASE` over HTTP, so any checkout's running dev server is what
  gets rendered, regardless of which `bin/browser/` you launch from.

## Generic core

Everything in `shot.mjs` except one line is framework-agnostic — it renders and
screenshots any web page. The only LiveView-specific part is the connectivity
probe:

```js
return !!(window.liveSocket && window.liveSocket.isConnected());
```

For a non-LiveView app, swap that line for the equivalent "did the JS app come
alive?" check (a mounted React root, `window.htmx` present, etc.). The comment
in `shot.mjs` marks the exact line.
