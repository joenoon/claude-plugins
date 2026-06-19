# liveview-browser-verify Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `liveview-browser-verify` skill to the `phoenix` plugin that renders a real LiveView page in headless Chromium and screenshots it, with the agent bootstrapping the harness into any project on demand.

**Architecture:** A second skill directory under `plugins/phoenix/skills/`. It ships a small, framework-agnostic Playwright harness (`shot.mjs` + `setup.sh` + `package.json` + `.gitignore`) as template files under `references/browser/`, and a SKILL.md written as agent instructions: when asked to browser-verify, the agent copies the harness into the target project's `bin/browser/`, runs setup, ensures a dev-login route exists, runs the shot, and reads the screenshot.

**Tech Stack:** Markdown skill content; Node ESM + Playwright (`^1.60.0`) + Chromium; bash setup script.

## Global Constraints

- Repo: `~/phx-skill` (the `joenoon/claude-plugins` marketplace). All work lands here, NOT in `~/podclave`.
- Skill lives at `plugins/phoenix/skills/liveview-browser-verify/` — auto-discovered by the existing `phoenix` plugin; **no** `marketplace.json` or `plugin.json` change needed.
- The screenshot mechanism stays framework-agnostic; the **only** LiveView-specific line is the `window.liveSocket.isConnected()` probe, which carries a `// swap this line ...` comment.
- Podclave's own `bin/browser/` is NOT touched by this work (out of scope — one concern per change).
- No React/htmx/Vue profile files; no Playwright `storageState` mechanism (both explicit non-goals).
- Banned words in all content (code, docs, comments, copy): `load-bearing`, `substrate`, `wedge`, `seam`, `vestigial`, `tapestry`, `delve`. (`seamless` is fine.)
- Spec: `docs/superpowers/specs/2026-06-19-liveview-browser-verify-design.md`.

---

### Task 1: Ship the browser harness template files

**Files:**
- Create: `plugins/phoenix/skills/liveview-browser-verify/references/browser/shot.mjs`
- Create: `plugins/phoenix/skills/liveview-browser-verify/references/browser/setup.sh`
- Create: `plugins/phoenix/skills/liveview-browser-verify/references/browser/package.json`
- Create: `plugins/phoenix/skills/liveview-browser-verify/references/browser/.gitignore`

**Interfaces:**
- Produces: a runnable CLI `node bin/browser/shot.mjs <path> [--auth] [--mobile] [--name foo]` that reads env `BASE` (default `http://127.0.0.1:8080`), `AUTH_PATH` (default `/dev/login?email=`), `AUTH_EMAIL` (default empty), `WAIT` (default `1500`), and prints lines `url:`, `status:`, `liveViewConnected:`, `title:`, `text:`, `shot:`. SKILL.md (Task 2) references this contract and these file paths.

- [ ] **Step 1: Create `shot.mjs`**

Create `plugins/phoenix/skills/liveview-browser-verify/references/browser/shot.mjs`:

```js
// One-command UI check: render a page in headless Chromium, optionally logged
// in, and screenshot it. Copied into a project's bin/browser/ by the
// liveview-browser-verify skill. See that skill's SKILL.md.
//
//   node bin/browser/shot.mjs <path> [--auth] [--mobile] [--name foo]
//
//   --auth     log in first via the dev-login backdoor (AUTH_PATH)
//   --mobile   390px viewport (else 1280px)
//   --name     screenshot basename (default: derived from path)
//
//   BASE        target origin (default http://127.0.0.1:8080)
//   AUTH_PATH   dev-login route prefix; the email is appended url-encoded
//               (default /dev/login?email=)
//   AUTH_EMAIL  who to log in as (required with --auth)
//   WAIT        ms to settle after load (default 1500)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SHOTS = join(import.meta.dirname, "shots");
mkdirSync(SHOTS, { recursive: true });

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith("--")) || "/";
const auth = args.includes("--auth");
const mobile = args.includes("--mobile");
const ni = args.indexOf("--name");
const name = ni >= 0 ? args[ni + 1] : path.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root";

const BASE = process.env.BASE || "http://127.0.0.1:8080";
const AUTH_PATH = process.env.AUTH_PATH || "/dev/login?email=";
const EMAIL = process.env.AUTH_EMAIL || "";
const WAIT = Number(process.env.WAIT) || 1500;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
  });

  if (auth) {
    // Dev-only backdoor login — skips the email-code flow and its per-hour
    // rate limit. The redirect sets the session cookie. AUTH_PATH must point
    // at a route you compile-gate to dev (see SKILL.md "dev-login backdoor").
    await page.goto(`${BASE}${AUTH_PATH}${encodeURIComponent(EMAIL)}`, { waitUntil: "load" });
  }

  const resp = await page.goto(`${BASE}${path}`, { waitUntil: "load" });
  await page.waitForTimeout(WAIT);
  const lv = await page.evaluate(() => {
    try {
      // Swap this line for a non-LiveView app's hydration check — e.g. a React
      // root being mounted, or window.htmx being present.
      return !!(window.liveSocket && window.liveSocket.isConnected());
    } catch (_) {
      return false;
    }
  });
  const out = join(SHOTS, `${name}${mobile ? "-m" : ""}.png`);
  await page.screenshot({ path: out, fullPage: true });

  console.log(`url: ${page.url()}`);
  console.log(`status: ${resp ? resp.status() : "?"}`);
  console.log(`liveViewConnected: ${lv}`);
  console.log(`title: ${await page.title()}`);
  console.log(`text: ${(await page.locator("body").innerText()).replace(/\s+/g, " ").trim().slice(0, 200)}`);
  console.log(`shot: ${out}`);
} finally {
  await browser.close();
}
```

- [ ] **Step 2: Create `setup.sh`**

Create `plugins/phoenix/skills/liveview-browser-verify/references/browser/setup.sh`:

```bash
#!/usr/bin/env bash
# One-shot setup for the headless-browser verify tooling. Run once per machine
# (persisted by a Sprite checkpoint thereafter). Installs Playwright, Chromium,
# and the system libs Chromium needs.
set -euo pipefail
cd "$(dirname "$0")"

npm install

# Browser binary (lands in ~/.cache/ms-playwright; shared across projects).
./node_modules/.bin/playwright install chromium

# System libs via apt. `sudo` drops node from PATH, so pass the current PATH
# through `env` or the playwright shebang (#!/usr/bin/env node) can't resolve.
sudo env "PATH=$PATH" ./node_modules/.bin/playwright install-deps chromium

echo
echo "Done. Start your dev server (e.g. PORT=8080 mix phx.server), then:"
echo "  node bin/browser/shot.mjs /                          # a public page"
echo "  AUTH_EMAIL=<dev-user> node bin/browser/shot.mjs /dashboard --auth"
```

- [ ] **Step 3: Create `package.json`**

Create `plugins/phoenix/skills/liveview-browser-verify/references/browser/package.json`:

```json
{
  "name": "phoenix-browser-tools",
  "private": true,
  "type": "module",
  "description": "Headless-browser dev tooling for verifying a LiveView UI end-to-end.",
  "dependencies": {
    "playwright": "^1.60.0"
  }
}
```

- [ ] **Step 4: Create `.gitignore`**

Create `plugins/phoenix/skills/liveview-browser-verify/references/browser/.gitignore` (protects both this repo and any project the harness is copied into):

```
node_modules/
shots/
package-lock.json
```

- [ ] **Step 5: Syntax-check the script**

Run:
```bash
node --check ~/phx-skill/plugins/phoenix/skills/liveview-browser-verify/references/browser/shot.mjs && chmod +x ~/phx-skill/plugins/phoenix/skills/liveview-browser-verify/references/browser/setup.sh
```
Expected: no output, exit 0 (syntax valid; setup.sh made executable).

- [ ] **Step 6: Functional smoke against a real LiveView app (Podclave dev server)**

Install Playwright in the template dir (Chromium is already cached from Podclave's setup, so this is fast):
```bash
cd ~/phx-skill/plugins/phoenix/skills/liveview-browser-verify/references/browser && npm install
```

Ensure a LiveView dev server is reachable on :8080. Check, and start Podclave's if needed:
```bash
curl -so /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/ || echo "down"
```
If `down` or non-2xx/3xx: start it from the main Podclave checkout per its CLAUDE.md — `cd ~/podclave && PORT=8080 mix phx.server` (run in background), wait ~10s for boot.

Then run the new script against the public root page:
```bash
node ~/phx-skill/plugins/phoenix/skills/liveview-browser-verify/references/browser/shot.mjs /
```
Expected: prints `status: 200` and `liveViewConnected: true`, and `shot: .../shots/root.png`. Open/read the PNG to confirm a rendered page (not a blank/error page).

If a LiveView dev server genuinely cannot be started, this functional smoke is the one step that may be skipped — but Step 5's `node --check` must still pass, and the script must be byte-for-byte the embedded content above.

- [ ] **Step 7: Commit**

```bash
cd ~/phx-skill && git add plugins/phoenix/skills/liveview-browser-verify/references/browser && git commit -m "feat(phoenix): add browser-verify harness templates (shot.mjs/setup.sh)"
```

---

### Task 2: Write the SKILL.md

**Files:**
- Create: `plugins/phoenix/skills/liveview-browser-verify/SKILL.md`

**Interfaces:**
- Consumes: the harness file paths and CLI contract from Task 1 (`references/browser/{shot.mjs,setup.sh,package.json,.gitignore}`; `node bin/browser/shot.mjs <path> [--auth] [--mobile]`).
- Produces: nothing downstream — this is the terminal deliverable.

- [ ] **Step 1: Create `SKILL.md`**

Create `plugins/phoenix/skills/liveview-browser-verify/SKILL.md`:

```markdown
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

\`\`\`
node bin/browser/shot.mjs <path> [--auth] [--mobile] [--name foo]
\`\`\`

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

\`\`\`elixir
if Application.compile_env(:my_app, :dev_routes) do
  scope "/dev" do
    pipe_through :browser
    get "/login", MyAppWeb.DevLoginController, :create
  end
end
\`\`\`

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

\`\`\`js
return !!(window.liveSocket && window.liveSocket.isConnected());
\`\`\`

For a non-LiveView app, swap that line for the equivalent "did the JS app come
alive?" check (a mounted React root, `window.htmx` present, etc.). The comment
in `shot.mjs` marks the exact line.
```

- [ ] **Step 2: Validate the frontmatter**

Run:
```bash
cd ~/phx-skill && head -5 plugins/phoenix/skills/liveview-browser-verify/SKILL.md
```
Expected: lines `---`, `name: liveview-browser-verify`, a `description:` line, `---`, then the H1. Confirm `name` matches the directory name exactly.

- [ ] **Step 3: Banned-words + altitude check**

Run:
```bash
grep -nE 'load-bearing|substrate|wedge|\bseam\b|vestigial|tapestry|delve' ~/phx-skill/plugins/phoenix/skills/liveview-browser-verify/SKILL.md && echo "FOUND — fix" || echo "clean"
```
Expected: `clean`. (Note the regex intentionally allows `seamless`.)

- [ ] **Step 4: Commit**

```bash
cd ~/phx-skill && git add plugins/phoenix/skills/liveview-browser-verify/SKILL.md && git commit -m "feat(phoenix): add liveview-browser-verify SKILL.md"
```

---

## Self-Review

**Spec coverage:**
- "Its own skill in phoenix plugin" → skill dir created, no marketplace/plugin.json change (Global Constraints, Task 1/2 paths). ✓
- "Agent-driven bootstrap, not a human checklist" → SKILL.md "Bootstrap (do this for the user, silently)" steps 1–5. ✓
- "Templates copied in" → Task 1 ships 4 files; SKILL.md step 1 copies them. ✓
- "shot.mjs changes: AUTH_PATH, drop Podclave defaults, swap-this comment" → Task 1 Step 1. ✓
- "setup.sh with sudo env PATH gotcha" → Task 1 Step 2. ✓
- "package.json name phoenix-browser-tools" → Task 1 Step 3. ✓
- "dev-login backdoor pattern" → SKILL.md "The dev-login backdoor". ✓
- "worktree node_modules / app.js 404 gotcha" → SKILL.md "Gotchas". ✓
- "generic-core note + swap line" → SKILL.md "Generic core" + shot.mjs comment. ✓
- "Podclave copy untouched; no React/htmx profiles; no storageState" → Global Constraints + nothing in tasks touches them. ✓

**Placeholder scan:** No TBD/TODO; every file's full content is embedded. ✓

**Type/contract consistency:** Env names (`BASE`/`AUTH_PATH`/`AUTH_EMAIL`/`WAIT`) and output lines used in Task 2's SKILL.md match Task 1's `shot.mjs` exactly. File paths consistent across both tasks. ✓
```
