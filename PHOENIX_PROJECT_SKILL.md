# Phoenix project skill — opinionated patterns to port

Distilled from the Podclave control plane (Phoenix 1.7 / LiveView 1.1 / Elixir 1.19 / OTP 27, deployed on Fly). The Podclave-specific business logic is stripped; what's left is the structural and stylistic philosophy you can carry to a new Phoenix project on day one.

---

## Guiding philosophy

- **Boring stack, opinionated assembly.** Stock Phoenix + LiveView + Ecto + Oban + Req. No exotic libraries. The opinions show up in how things are wired together, not in what's chosen.
- **Runtime over compile-time.** Config is loaded at boot from env vars (`runtime.exs`). The build doesn't bake secrets or hostnames.
- **Auth is a routing concern**, not a per-LV concern. Three `live_session` tiers (public / authed / admin) gate everything. No middleware-style guards in individual LiveViews.
- **Session cookies only.** No JWTs, no Bearer-token API scope, no separate `/api/*`. If a service needs to call in, it gets a `Phoenix.Token` issued by the control plane, never a long-lived credential.
- **Lightweight UI forms.** `to_form(%{}, as: :key)` over Ecto changesets for forms that aren't backed by a schema (search bars, modal inputs, intents). Changesets are for persistence; forms are for UI state.
- **Async with explicit state.** `Phoenix.LiveView.AsyncResult` for every async fetch; loading state is rendered, not hidden.
- **No "platform" layer.** Contexts group by domain (`lib/myapp/accounts/`, `lib/myapp/billing/`). One Repo. No GenServer registry per context. Cross-cutting infra (PubSub topics, encryption vault) lives at `lib/myapp/`.
- **Process docs are committed.** Specs, plans, design notes live under `priv/docs/YYYY-MM-DD-<topic>-<kind>.md` and move with the feature branch. The branch's HISTORY entry and ACTIVE_STATE clear are the *last commit* before merging.

---

## Project structure

```
.
├── assets/                       # esbuild + tailwind sources
│   ├── css/app.css               # @apply-free, CSS variables for theming
│   ├── js/
│   │   ├── app.js                # registers hooks, sets pm-suppression default
│   │   └── hooks/                # one hook per file, plain-export style
│   ├── tailwind.config.js
│   └── vendor/                   # any non-npm js dropped in here
├── bin/setup_dev.sh              # idempotent local bootstrap (postgres + deps + seed)
├── config/
│   ├── config.exs                # compile-time defaults
│   ├── dev.exs                   # ^-anchored live_reload, dirs explicit
│   ├── test.exs
│   ├── runtime.exs               # ALL secrets, hosts, prod tuning
│   └── prod.exs                  # nearly empty; delegates to runtime
├── lib/
│   ├── myapp/                    # domains: accounts/, billing/, ...
│   │   ├── application.ex
│   │   ├── repo.ex
│   │   ├── schema.ex             # base `use Myapp.Schema` macro
│   │   ├── vault.ex              # Cloak vault (if encrypting fields)
│   │   ├── mail/                 # email integration
│   │   └── workers/              # Oban workers
│   └── myapp_web/
│       ├── auth.ex               # plugs + on_mount hooks (single source)
│       ├── components/           # core_components.ex + tiny design system
│       ├── controllers/          # only auth + downloads — LVs do the rest
│       ├── live/                 # one folder per top-level live route
│       ├── plugs/                # custom plugs (e.g. FlyClientIp)
│       ├── endpoint.ex
│       └── router.ex
├── priv/
│   ├── docs/                     # specs/plans/design tracked in git
│   ├── repo/migrations/
│   └── static/vendor/            # pre-built JS/CSS, whitelisted via static_paths
├── rel/
│   ├── env.sh.eex                # release env: clustering, node name, cookie
│   └── overlays/bin/migrate      # release command: `eval Myapp.Release.migrate`
├── test/support/                 # ConnCase + DataCase + plug-based HTTP stubs
├── .github/workflows/
│   ├── preview.yml               # per-PR ephemeral fly app + DB branch
│   └── release.yml               # push to `release-prod` deploys + auto-tags
├── Dockerfile                    # multi-stage; runtime.exs copied AFTER compile
├── fly.toml
└── mix.exs                       # loose pins (~> 1.14, etc.), aliases below
```

---

## mix.exs

```elixir
# loose version pins — local & prod can be ahead of mix.exs floor
{:phoenix, "~> 1.7"},
{:phoenix_live_view, "~> 1.1"},
{:ecto_sql, "~> 3.10"},
{:postgrex, ">= 0.0.0"},
{:req, "~> 0.5"},          # HTTP client of choice (not Finch directly)
{:oban, "~> 2.17"},
{:oban_web, "~> 2.10"},
{:cloak, "~> 1.1"},        # only if you encrypt fields
{:phoenix_live_dashboard, "~> 0.8"},

# aliases
aliases: [
  setup: ["deps.get", "assets.setup", "assets.build"],
  "assets.setup": ["tailwind.install --if-missing", "esbuild.install --if-missing"],
  "assets.build": ["tailwind default", "esbuild default"],
  "assets.deploy": ["tailwind default --minify", "esbuild default --minify", "phx.digest"],
  "ecto.setup": ["ecto.create", "ecto.migrate", "run priv/repo/seeds.exs"],
  "ecto.reset": ["ecto.drop", "ecto.setup"],
  test: ["ecto.create --quiet", "ecto.migrate --quiet", "test"]
]
```

Loose pins mean you can run Elixir 1.19 / OTP 27 in prod even though `mix.exs` only floors at `~> 1.14`. Don't tighten without a reason.

---

## Config split

**`config.exs`** — compile-time defaults only. Generator timestamps, Ecto adapter config (binary_id PKs, gen_random_uuid, utc_datetime_usec), esbuild/tailwind versions pinned, Oban queues. Nothing environment-specific.

**`dev.exs`** — local dev. Endpoint binds `127.0.0.1:8080`, `check_origin: false`, dev mailer. Live-reload patterns are caret-anchored and `dirs:` is explicit:

```elixir
config :myapp, MyappWeb.Endpoint,
  live_reload: [
    dirs: ["priv/static", "priv/gettext", "lib"],
    patterns: [
      ~r"^priv/static/.*(js|css|png|jpeg|jpg|gif|svg)$",
      ~r"^priv/gettext/.*(po)$",
      ~r"^lib/myapp_web/(controllers|live|components)/.*(ex|heex)$"
    ]
  ]
```

The `^` anchors are critical: they prevent worktree/session subdirs (e.g. `.claude/`, `.worktrees/`) from triggering reloads.

**`prod.exs`** — almost empty; sets `config :logger, level: :info` and delegates everything else.

**`runtime.exs`** — the real prod config. Loaded at boot. Every secret read with `System.fetch_env!/1` (raises on missing). Pattern:

```elixir
if config_env() == :prod do
  host = System.fetch_env!("PHX_HOST")
  port = String.to_integer(System.get_env("PORT") || "4000")

  config :myapp, MyappWeb.Endpoint,
    url: [host: host, port: 443, scheme: "https"],
    http: [ip: {0, 0, 0, 0, 0, 0, 0, 0}, port: port],   # IPv6 for Fly
    check_origin: ["https://#{host}"],                   # SINGLE origin
    secret_key_base: System.fetch_env!("SECRET_KEY_BASE"),
    server: !!System.get_env("PHX_SERVER"),
    force_ssl: [hsts: true]

  config :myapp, Myapp.Repo,
    url: System.fetch_env!("DATABASE_URL"),
    pool_size: String.to_integer(System.get_env("POOL_SIZE") || "10"),
    socket_options: [:inet6]
end
```

In dev, `runtime.exs` can also generate a stable `SECRET_KEY_BASE` to a disk file so sessions survive restarts.

---

## Deployment (Fly + releases)

**`fly.toml`** — pin `min_machines_running` to your real floor (we use 2 in `iad`). Never let auto-stop bring you to zero. `release_command = "/app/bin/migrate"`. Set `PHX_HOST` in `[env]`.

**`Dockerfile`** is multi-stage with one ordering rule that matters:

```dockerfile
# ... mix deps ...
COPY config/config.exs config/prod.exs config/
COPY lib lib
RUN mix compile

# runtime.exs copied AFTER compile — secret changes don't invalidate the compile layer
COPY config/runtime.exs config/
```

**`rel/env.sh.eex`** — Fly clustering needs explicit IPv6 + a release cookie from a separate Fly secret (never baked into the image):

```bash
export RELEASE_COOKIE="${RELEASE_COOKIE}"
export DNS_CLUSTER_QUERY="${FLY_APP_NAME}.internal"
export ERL_AFLAGS="-proto_dist inet6_tcp"
export RELEASE_NODE="${FLY_APP_NAME}-${FLY_IMAGE_REF}@${FLY_PRIVATE_IP}"
```

**`rel/overlays/bin/migrate`** — small shell shim that calls `./myapp eval "Myapp.Release.migrate()"`. `Myapp.Release` is a release module that loads the app, starts the repo, runs migrations, then shuts down — same pattern Phoenix generates.

**Anything served from a release uses runtime priv_dir.** Compile-time module attributes like `@external_resource Path.join(:code.priv_dir(:myapp), "x")` resolve to `_build/<env>/lib/.../priv` at compile time, not the release's runtime `lib/myapp-<ver>/priv`. Read paths at runtime: `Path.join(:code.priv_dir(:myapp), "...")`.

**Worktrees: symlink `deps/`, never `_build/`.** A shared `_build/` across worktrees serves stale assets because the inner `priv` symlink in `_build/dev/lib/myapp/priv` resolves to whichever repo ran the last compile.

---

## Router architecture

```elixir
pipeline :browser do
  plug :accepts, ["html"]
  plug :fetch_session
  plug :fetch_live_flash
  plug :put_root_layout, html: {MyappWeb.Layouts, :root}
  plug :protect_from_forgery
  plug :put_secure_browser_headers
  plug :fetch_current_user                       # Auth plug → sets conn.assigns
end

pipeline :authed do
  plug :require_user                              # Auth plug → halts + redirect
end

pipeline :admin do
  plug :require_admin
end

scope "/", MyappWeb do
  pipe_through :browser
  live_session :public, on_mount: [{Auth, :fetch_current_user}] do
    live "/", HomeLive, :index
  end
  get "/login", AuthController, :new
  post "/login", AuthController, :create
  get "/verify", AuthController, :verify_form
  post "/verify", AuthController, :verify
  delete "/logout", AuthController, :delete
end

scope "/", MyappWeb do
  pipe_through [:browser, :authed]
  live_session :authenticated, on_mount: [{Auth, :require_user}] do
    live "/dashboard", DashboardLive, :index
    # ... all the protected LVs ...
  end
end

scope "/phx", MyappWeb do                         # admin namespace
  pipe_through [:browser, :authed, :admin]
  import Oban.Web.Router
  oban_dashboard "/oban"
  live_session :admin, on_mount: [{Auth, :require_admin}] do
    live "/users", Admin.UsersLive, :index
  end
end
```

Three rules:

1. **Auth is paired** — plug protects the HTTP request, `on_mount` hook protects the LiveView socket. Both live in one `Auth` module. Same predicate, different surface.
2. **Login/logout are controllers, not LiveViews.** Session lifecycle is HTTP-level. Keep it boring.
3. **`/phx/*` is the admin scope.** It hosts Oban dashboard, future admin tools. Gated by `user.role == "admin"`. Extensible without spreading admin checks across the codebase.

---

## Auth module

One file: `lib/myapp_web/auth.ex`. Exposes plugs *and* on_mount hooks. The hooks use `assign_new/3` so `current_user` is loaded at most once per socket lifecycle:

```elixir
def on_mount(:fetch_current_user, _params, session, socket) do
  {:cont, mount_current_user(session, socket)}
end

def on_mount(:require_user, _params, session, socket) do
  socket = mount_current_user(session, socket)
  if socket.assigns.current_user,
    do: {:cont, socket},
    else: {:halt, Phoenix.LiveView.redirect(socket, to: "/login")}
end

defp mount_current_user(session, socket) do
  Phoenix.Component.assign_new(socket, :current_user, fn ->
    if uid = session["user_id"], do: Accounts.get_user(uid)
  end)
end
```

**Login flow (email + 6-digit code)** — captured here because it's portable and password-free:

1. `POST /login` with `email` → `Accounts.issue_verification_code/1` generates a 6-digit code (`:crypto.strong_rand_bytes(3)` → integer → `rem 1_000_000` → zero-padded), stores it in `email_verifications` with a 10-minute TTL and `consumed_at: nil`, emails via Resend.
2. `POST /verify` with `email + code` → `Accounts.verify_code/2` finds the latest unconsumed code for that email, checks expiry + attempt count, increments `attempts` on miss, sets `consumed_at` on hit.
3. On success: `upsert_user_by_email/1` (idempotent), then `Auth.log_in_user/2` does `configure_session(renew: true) |> clear_session() |> put_session(:user_id, user.id)`.
4. Rate-limit: max 5 codes per email per rolling hour. Max 5 verify attempts per code.

No passwords, no JWTs. Sessions are the auth.

---

## LiveView state idioms

### `AsyncResult` for every async fetch

```elixir
def mount(_params, _session, socket) do
  {:ok,
    socket
    |> assign(:projects, AsyncResult.loading())
    |> start_async(:projects, fn -> Billing.list_projects(user_id) end)}
end

def handle_async(:projects, {:ok, projects}, socket) do
  {:noreply, assign(socket, :projects, AsyncResult.ok(projects))}
end

def handle_async(:projects, {:exit, reason}, socket) do
  {:noreply, assign(socket, :projects, AsyncResult.failed(reason))}
end
```

Render the three states explicitly in the template (`<.async_result :let={...}>`). Loading is a UI state, not absence of UI.

### PubSub subscriptions guarded by `connected?/1`

```elixir
def mount(%{"id" => id}, _session, socket) do
  if connected?(socket) do
    Phoenix.PubSub.subscribe(Myapp.PubSub, "thing:#{id}")
  end
  {:ok, assign(socket, :id, id)}
end
```

LiveView mounts twice (dead render + connected). Subscribe only on the connected mount to avoid leaks.

### In-flight dedup with `MapSet`

For "double-click prevention" without disabling buttons:

```elixir
def handle_event("delete", %{"id" => id}, socket) do
  if MapSet.member?(socket.assigns.in_flight, id) do
    {:noreply, socket}
  else
    socket = assign(socket, :in_flight, MapSet.put(socket.assigns.in_flight, id))
    start_async({:delete, id}, fn -> Billing.delete(id) end)
    {:noreply, socket}
  end
end
```

### Forms for UI state, changesets for persistence

```elixir
defp blank_search_form, do: to_form(%{"q" => ""}, as: :search)

def handle_event("search_change", %{"search" => params}, socket) do
  {:noreply, assign(socket, :search_form, to_form(params, as: :search))}
end
```

No changeset boilerplate for forms that aren't a schema.

---

## Components + design system

Two layers:

1. **`core_components.ex`** — generated by `mix phx.new`; keep `<.flash>`, `<.input>`, `<.button>`, `<.icon>`, `<.modal>`. Customize freely.
2. **Small design-system module** (`MyappWeb.HomeStyle` or similar) with 2–5 components used across landing/marketing/app — e.g. `<.chip>`, `<.glass>` card, `<.gradient_text>`. Imported globally via `html_helpers/0` in `MyappWeb`.

**Flash** is a styled component + a `FlashToast` JS hook for auto-dismiss after ~5s (CSS animation, pause on hover). Connection-loss flashes (`phx-disconnected` / `phx-connected`) are persistent — never auto-dismissed.

**Tailwind:** dark-only theme, CSS variables in `:root` (no `dark:` variant clutter), heroicons via the Tailwind plugin shipped with `mix phx.new`. Custom fonts loaded from a font CDN, not vendored.

**No `@apply`-built components.** Plain CSS classes for `.glass` etc. Easier to theme globally; doesn't entangle component CSS with Tailwind config.

---

## JS hooks

`assets/js/app.js` registers hooks as a flat object — no dynamic loader:

```javascript
import {Terminal} from "./hooks/terminal"
import {DropZone} from "./hooks/dropzone"
import {FlashToast} from "./hooks/flash_toast"

const liveSocket = new LiveSocket("/live", Socket, {
  hooks: {Terminal, DropZone, FlashToast},
  // ...
})
```

**Password manager suppression by default.** Globally add `data-1p-ignore`, `data-lpignore`, `data-bwignore` etc. to every `input` and `textarea` on the page; opt back in per-element with `data-pm-allow="true"`. Prevents 1Password/Bitwarden from injecting fields during LiveView morphdom patches (which breaks UI).

**Vendored browser libs** go in `priv/static/vendor/<lib>/` and the directory must be whitelisted:

```elixir
# lib/myapp_web.ex
def static_paths, do: ~w(assets fonts images vendor favicon.ico robots.txt)
```

Loaded with plain `<script>` tags in `root.html.heex`. No npm dependency for things like xterm.js or a charting lib.

---

## Endpoint

Standard plug order plus one custom plug for Fly client IP:

```elixir
# lib/myapp_web/plugs/fly_client_ip.ex
defmodule MyappWeb.Plugs.FlyClientIp do
  @behaviour Plug
  def init(opts), do: opts
  def call(conn, _opts) do
    case Plug.Conn.get_req_header(conn, "fly-client-ip") do
      [ip | _] -> Plug.Conn.assign(conn, :fly_client_ip, ip)
      _ -> conn
    end
  end
end
```

Stash in `conn.assigns`, **don't rewrite `remote_ip`** — let downstream code opt in.

---

## Contexts + Ecto

### Base schema macro

```elixir
defmodule Myapp.Schema do
  defmacro __using__(_) do
    quote do
      use Ecto.Schema
      @primary_key {:id, :binary_id, autogenerate: true}
      @foreign_key_type :binary_id
      @timestamps_opts [type: :utc_datetime_usec]
    end
  end
end
```

UUID PKs everywhere, microsecond UTC timestamps. Every schema does `use Myapp.Schema`.

### Soft-delete via timestamp

`consumed_at`, `archived_at`, `cancelled_at` — not booleans. Lets you query "what was the state at time T" without losing data, and makes scopes obvious (`where: is_nil(c.archived_at)`).

### Encrypted fields with Cloak (when needed)

A single `Myapp.Vault` module configured at boot with a base64 key from `DB_KEY` env. Sensitive columns use a Cloak EctoType. Don't field-encrypt by default — pay the complexity only where you have to.

### Migrations

`timestamps(type: :utc_datetime_usec)` everywhere. `pg` advisory locks for migration coordination (default in Ecto SQL). One Repo. No per-context Repo.

---

## Oban

```elixir
# config/config.exs
config :myapp, Oban,
  engine: Oban.Engines.Basic,
  notifier: Oban.Notifiers.PG,
  queues: [default: 10, mail: 5, periodic: 3],
  repo: Myapp.Repo

# lib/myapp/application.ex
{Oban, Application.fetch_env!(:myapp, Oban)},
```

Mount `oban_web` at `/phx/oban` (admin scope).

**Two opinionated worker patterns:**

1. **Coalescing dedup** with `unique` — multiple enqueues collapse to one in-flight job:
   ```elixir
   use Oban.Worker, queue: :default, unique: [keys: [:user_id], period: 60]
   ```
2. **Polling via `snooze`** — for "watch this resource until a condition" jobs, return `{:snooze, 30}` from `perform/1` instead of re-enqueuing. Stops naturally when no watchers.

---

## External HTTP clients

Use **`Req`**, not Finch/HTTPoison/Tesla. Thin module per integration, with a test-plug seam:

```elixir
defmodule Myapp.Resend do
  @endpoint "https://api.resend.com/emails"

  def send(email) do
    Application.get_env(:myapp, :resend_api_key)
    |> case do
      nil -> :ok  # fail open in dev: log + noop, don't crash
      key -> do_send(email, key)
    end
  end

  defp do_send(email, key) do
    [url: @endpoint, json: email, headers: [{"authorization", "Bearer #{key}"}]]
    |> maybe_with_plug()
    |> Req.post()
    |> handle_response()
  end

  defp maybe_with_plug(opts) do
    case Application.get_env(:myapp, :resend_req_plug) do
      nil -> opts
      plug -> Keyword.put(opts, :plug, plug)
    end
  end
end
```

Tests stub by setting `:resend_req_plug` to a function with arity 1 (`fn conn -> ... end`). No mocking library, no Bypass, no Mox. The plug *is* the seam.

Fail open in dev when keys aren't set (`:ok` + log). Don't crash on missing creds for non-critical integrations.

---

## Testing

**`test/support/conn_case.ex`** extends `data_case.ex` + `Phoenix.ConnTest` + `Phoenix.LiveViewTest`. SQL Sandbox in `:manual` mode.

Helpers worth carrying:

```elixir
# In ConnCase
def log_in_user(conn, user),
  do: conn |> init_test_session(%{}) |> put_session(:user_id, user.id)

def create_admin, do: insert_user(role: "admin")
```

**Test data via context functions** (`Accounts.create_user(...)`), not ExMachina. Slightly more boilerplate but the factories never drift from real code.

**HTTP stubbing via Req plugs:**

```elixir
test "handles email send failure" do
  Application.put_env(:myapp, :resend_req_plug, fn conn ->
    Plug.Conn.send_resp(conn, 500, ~s({"error": "boom"}))
  end)
  on_exit(fn -> Application.delete_env(:myapp, :resend_req_plug) end)

  assert {:error, _} = Mail.send_welcome(user)
end
```

LiveView tests use `Phoenix.LiveViewTest` directly. No `phoenix_test` (yet).

---

## Dev workflow

**`bin/setup_dev.sh`** — idempotent local bootstrap. Installs/starts Postgres, runs `mix deps.get`, `mix compile`, `mix assets.setup`, `mix ecto.setup`. Safe to re-run after a cold boot.

**`mix setup`** — covers Elixir-side deps and assets. Use the shell script when also setting up the DB process.

**Live-reload anchored** — `^priv/...`, `^lib/...`. Don't let worktree subdirs trigger reloads.

**Default dev port = 8080**, not 4000. Frees up 4000 for whatever else you're poking at.

---

## CI/CD

**`.github/workflows/preview.yml`** — fires on PR open/sync/reopen/close:

- Creates a per-PR Fly app: `myapp-pr-<num>`.
- Creates a per-PR Neon (or Postgres) branch off prod or a seed branch.
- Sets a fresh `SECRET_KEY_BASE` per preview (sessions isolated).
- Reuses any shared encryption key (`DB_KEY`) so previews can decrypt seed data.
- Sticky comment on the PR with the preview URL.
- Tears down infra on PR close.

**`.github/workflows/release.yml`** — deploy by pushing the green commit to a `release-prod` branch:

- Builds + deploys to Fly.
- Waits for a 200 from the app's health URL.
- Auto-tags `prod-YYYY-MM-DD-<short-sha>`.
- Creates a GH Release with the changelog auto-generated from the previous prod tag.

No semantic versioning, no `mix.exs` `@version` bumps. The branch tip is the release.

Rollback: push an older SHA to `release-prod`. Done.

---

## Code quality tooling

Just **`.formatter.exs`** with the LiveView HTML formatter plugin:

```elixir
[
  import_deps: [:ecto, :ecto_sql, :phoenix],
  subdirectories: ["priv/*/migrations"],
  plugins: [Phoenix.LiveView.HTMLFormatter],
  inputs: ["*.{heex,ex,exs}", "{config,lib,test}/**/*.{heex,ex,exs}", "priv/*/seeds.exs"]
]
```

No Credo, no Dialyzer. Format + test + a careful PR review are the gates. Add Credo/Dialyzer later if the project grows past one or two contributors — they're net-negative early because they amplify trivial bikeshedding.

---

## PubSub conventions

One PubSub instance in the supervisor (`{Phoenix.PubSub, name: Myapp.PubSub}`). Topics are namespaced strings:

- `"user:#{user_id}"` — user-scoped events.
- `"thing:#{thing_id}"` — entity-scoped events.
- `"thing:#{thing_id}:progress"` — sub-channels per concern.

Broadcast from the context module (`Myapp.Things.broadcast_update/1`). Subscribe only in LiveViews — never in contexts.

Message shape is always a tagged tuple: `{:thing_updated, thing}` or `{:thing_progress, %{step: ..., status: ...}}`. Never raw maps; pattern-matchable from `handle_info/2`.

---

## Process docs

`priv/docs/` is tracked in git. File naming: `YYYY-MM-DD-<topic>-<kind>.md` where `kind ∈ {spec, plan, design}`.

Three living docs sit at the root of that folder:

- **`VISION.md`** — durable positioning ("why is this thing the way it is"). Rarely changes.
- **`HISTORY.md`** — ledger of shipped phases. One entry per merged PR worth remembering, with a commit range (`<first>..<docs-commit>`).
- **`ACTIVE_STATE.md`** — what's in flight, immediate next step. Cleared in the same PR that ships the work.

The HISTORY + ACTIVE_STATE update is the **last commit** of the feature branch — no follow-up doc PR.

---

## Words to avoid in code, docs, commits, UI copy

Reads as LLM-ghostwritten:

> load-bearing, substrate, wedge, seam, vestigial, tapestry, delve

`seam` is banned but `seamless` is fine. `leverage` and `robust` are fine. If you reach for one of the banned words, the idea usually has a more concrete name — say what the thing does instead of nominating it as architectural.

---

## Day-one checklist for the new project

- [ ] `mix phx.new myapp --binary-id --live`
- [ ] Loose-pin deps in `mix.exs`
- [ ] Add `Myapp.Schema` macro; convert generated schemas to `use Myapp.Schema`
- [ ] Move all prod config to `runtime.exs`
- [ ] Add caret-anchored `live_reload` patterns with explicit `dirs:`
- [ ] Set up `bin/setup_dev.sh`
- [ ] Build `Myapp.Auth` module (plugs + on_mount hooks)
- [ ] Wire three `live_session` tiers in the router (`:public` / `:authenticated` / `:admin`)
- [ ] Add password-manager suppression to `app.js`
- [ ] Add `priv/docs/` with `VISION.md` + empty `HISTORY.md` + `ACTIVE_STATE.md`
- [ ] Set up Fly app + `fly.toml` + `rel/env.sh.eex` with IPv6 + cookie
- [ ] Wire `preview.yml` for per-PR ephemeral previews
- [ ] Wire `release.yml` for branch-based deploy + auto-tag
- [ ] Add Oban + mount `oban_web` at `/phx/oban`
- [ ] Adopt Req + test-plug pattern for any external HTTP
- [ ] Skip Credo/Dialyzer until you actually need them
