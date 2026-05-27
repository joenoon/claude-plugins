# Config conventions

## Prod config lives in `runtime.exs`, not `prod.exs`

`prod.exs` does almost nothing (e.g. `config :logger, level: :info`). All
host/port/secret/pool-size configuration is loaded at boot from env vars in
`runtime.exs`. The build never bakes a secret or hostname.

Read every required env var with `System.fetch_env!/1`, not `System.get_env/1`.
The `!` raises if the var is missing, so a misconfigured deploy fails at boot
rather than silently using a default:

    secret_key_base: System.fetch_env!("SECRET_KEY_BASE")

## `check_origin` is a single allowed host

    check_origin: ["https://#{System.fetch_env!("PHX_HOST")}"]

Not a list. If a preview or staging environment needs a different origin, set
`PHX_HOST` differently for that deploy — don't widen production's allowlist.

## Caret-anchor `live_reload` patterns; set `dirs:` explicitly

    config :myapp, MyappWeb.Endpoint,
      live_reload: [
        dirs: ["priv/static", "priv/gettext", "lib"],
        patterns: [
          ~r"^priv/static/.*(js|css|png|jpeg|jpg|gif|svg)$",
          ~r"^priv/gettext/.*(po)$",
          ~r"^lib/myapp_web/(controllers|live|components)/.*(ex|heex)$"
        ]
      ]

The `^` anchors are not optional. Without them, every `.worktrees/`,
`.claude/`, or other subdirectory under the repo also triggers reloads when
files inside change, turning dev into a constant rebuild loop. Anchor
everything to the repo root.
