# Deployment (Fly)

## Template files

The narrative below explains the *why*. For the *what*, copy these
templates from `references/deployment-fly/` into your repo and edit for
your app:

- `fly.toml` — top-level Fly config. Set `app =`, `primary_region =`,
  `[env].PHX_HOST`.
- `Dockerfile` — multi-stage build with `runtime.exs` copied after
  compile so secret rotations don't invalidate the BEAM layer.
- `rel/env.sh.eex` — release boot env for IPv6 + clustering.
- `rel/overlays/bin/migrate` — one-line shim that runs migrations on
  release.

The template values use placeholders (`myapp` / `Myapp` /
`your-app.example.com`).

## `release_command` runs a migrate shim

    # fly.toml
    [deploy]
      release_command = '/app/bin/migrate'

`rel/overlays/bin/migrate` is one line: `exec ./myapp eval
Myapp.Release.migrate`. `Myapp.Release.migrate/0` is the standard
generated release module — loads the app, starts the repo, runs
migrations, shuts down.

## Dockerfile rule: copy `runtime.exs` AFTER compile

The Dockerfile template enforces this — `runtime.exs` lands in the
image after `mix compile`. Without that ordering, every secret rotation
rebuilds the BEAM bytecode.

## `RELEASE_COOKIE` is a separate Fly secret

Set `RELEASE_COOKIE` as its own Fly secret, distinct from any other.
Don't bake it into the image; don't piggyback on another secret's
value.

Without an explicit cookie, `mix release` invents a fresh random one
per build, and old/new releases in a rolling deploy can't reach each
other. With a stable cookie via Fly secret, the cluster survives
rolling deploys.

## `runtime.exs` prod block: IPv6 bind + force SSL

    if config_env() == :prod do
      host = System.fetch_env!("PHX_HOST")
      port = String.to_integer(System.get_env("PORT") || "8080")

      config :myapp, MyappWeb.Endpoint,
        url: [host: host, port: 443, scheme: "https"],
        http: [ip: {0, 0, 0, 0, 0, 0, 0, 0}, port: port],
        secret_key_base: System.fetch_env!("SECRET_KEY_BASE"),
        server: !!System.get_env("PHX_SERVER"),
        force_ssl: [hsts: true]

      config :myapp, Myapp.Repo,
        url: System.fetch_env!("DATABASE_URL"),
        pool_size: String.to_integer(System.get_env("POOL_SIZE") || "10"),
        socket_options: [:inet6]
    end

- `ip: {0, 0, 0, 0, 0, 0, 0, 0}` binds IPv6 (`::`). Fly's load
  balancer reaches the machine over its IPv6 private address; an IPv4
  bind silently refuses connections.
- `socket_options: [:inet6]` — Fly Postgres is also reached over IPv6.
- `force_ssl: [hsts: true]` enforces HTTPS at the application layer in
  addition to Fly's edge TLS.

## Fly client IP plug

Fly's edge sets `fly-client-ip` on every incoming request. Stash it in
`conn.assigns`; don't rewrite `remote_ip`:

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

## Runtime `priv_dir`, not compile-time `@external_resource`

In a release, `_build/<env>/lib/myapp/priv` is gone. Module attributes
like `@external_resource Path.join(:code.priv_dir(:myapp), "x")`
evaluate at compile time, where they resolve to the *build* `priv`,
not the runtime release's `priv`.

Resolve `priv` paths at runtime:

    def script_path do
      Path.join(:code.priv_dir(:myapp), "scripts/setup.sh")
    end

## Worktrees: symlink `deps/`, never `_build/`

A shared `_build/` across worktrees serves stale assets — the inner
`priv` symlink in `_build/dev/lib/myapp/priv` resolves to whichever
repo last compiled. Symlink `deps/` to share the compile cache, but
each worktree gets its own `_build/`.
