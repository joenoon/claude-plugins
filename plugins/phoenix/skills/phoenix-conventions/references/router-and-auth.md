# Router and Auth

## Three `live_session` tiers gate everything

Public, authenticated, admin. No per-LiveView guards.

    scope "/", MyappWeb do
      pipe_through :browser
      live_session :public, on_mount: [{Auth, :fetch_current_user}] do
        live "/", HomeLive, :index
      end
    end

    scope "/", MyappWeb do
      pipe_through [:browser, :authed]
      live_session :authenticated, on_mount: [{Auth, :require_user}] do
        live "/dashboard", DashboardLive, :index
      end
    end

    scope "/phx", MyappWeb do
      pipe_through [:browser, :authed, :admin]
      live_session :admin, on_mount: [{Auth, :require_admin}] do
        live "/users", Admin.UsersLive, :index
      end
    end

A new protected route is one line under the right `live_session`. A new
gating concern is a new tier, never a guard sprinkled inside a LiveView.

## Auth is paired: one module exposes plug and on_mount

A single `MyappWeb.Auth` module owns the HTTP plugs (`fetch_current_user`,
`require_user`, `require_admin`) and the corresponding `on_mount` hooks.
Same predicate, two surfaces — controllers and LiveView each call into the
same logic.

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

`assign_new/3` means `current_user` is loaded at most once across the dead
mount → connected mount cycle, not re-fetched per LV.

## Login / logout are HTTP controllers, not LiveViews

Session lifecycle is an HTTP concern — `put_session`, `clear_session`,
`configure_session(renew: true)`. Keep that in a controller. LiveViews
inherit the session that's already on the socket.

## `/phx/*` is the admin namespace

All admin tooling lives under `/phx/*` piped through `[:browser, :authed, :admin]` —
Oban dashboard, debug tools, anything you'd be embarrassed to leak. One
place to gate, never spreads.

    scope "/phx", MyappWeb do
      pipe_through [:browser, :authed, :admin]
      import Oban.Web.Router
      oban_dashboard "/oban"
    end

## Auth flow: email + 6-digit code, no passwords

No password column, no JWT. Sessions are the auth.

1. `POST /login` with `email`. `Accounts.issue_verification_code/1`
   generates a 6-digit code, stores it in `email_verifications` with a
   10-minute TTL and `consumed_at: nil`, sends it via email:

       :crypto.strong_rand_bytes(3)
       |> :binary.decode_unsigned()
       |> rem(1_000_000)
       |> Integer.to_string()
       |> String.pad_leading(6, "0")

2. `POST /verify` with `email + code`. `Accounts.verify_code/2` finds the
   latest unconsumed code for that email, checks expiry + attempt count,
   increments `attempts` on miss, sets `consumed_at` on hit.

3. On success: `upsert_user_by_email/1` (idempotent — never fail because
   the user record doesn't exist yet), then `Auth.log_in_user/2`:

       conn
       |> configure_session(renew: true)
       |> clear_session()
       |> put_session(:user_id, user.id)
       |> redirect(to: signed_in_path(user))

   `configure_session(renew: true)` + `clear_session()` together prevent
   session fixation: the cookie is rotated before any session data is
   written.

4. Rate limits: max 5 codes per email per rolling hour. Max 5 verify
   attempts per code.
