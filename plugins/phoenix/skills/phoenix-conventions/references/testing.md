# Testing

## SQL Sandbox: shared connection toggled by `:async` tag

Tests use Ecto's SQL Sandbox. Pool configured in `config/test.exs`:

    config :myapp, Myapp.Repo, pool: Ecto.Adapters.SQL.Sandbox

Each test's setup checks out a connection. `shared: true` for synchronous
tests, `shared: false` for async — so async tests get their own
connection, sync tests share one with spawned processes (LiveViews,
Oban jobs) that need to see uncommitted test data:

    setup tags do
      pid = Ecto.Adapters.SQL.Sandbox.start_owner!(Myapp.Repo, shared: not tags[:async])
      on_exit(fn -> Ecto.Adapters.SQL.Sandbox.stop_owner(pid) end)
      {:ok, conn: Phoenix.ConnTest.build_conn()}
    end

This setup goes in `test/support/conn_case.ex` and `data_case.ex`. Both
should use the same shared-or-not logic.

## `log_in_user/2` helper mirrors real auth

Match what the real `Auth.log_in_user/2` does — stuff `user_id` into
the session via `Plug.Test.init_test_session`:

    def log_in_user(conn, user) do
      Plug.Test.init_test_session(conn, %{user_id: user.id})
    end

Lives on `ConnCase` so any conn test can call it. No mocking of the
auth module; the test session passes the real `require_user` plug.

## Test data via context functions, not factories

Use the real context API (`Accounts.create_user/1`) to set up test data.
No `ExMachina`, no test-only factories that drift from production code:

    def create_admin do
      {:ok, admin} =
        Myapp.Accounts.create_user(%{
          email: "admin-#{System.unique_integer([:positive])}@x.com",
          role: "admin"
        })

      admin
    end

Pros: factories never drift from real code; you catch validation
regressions in tests for free. Cons: slightly more boilerplate per
fixture. Worth it — drifting factories cause real bugs.

`System.unique_integer([:positive])` keeps emails and other unique
fields collision-free across parallel test runs.

## HTTP stubs via Req's `:plug` option

External HTTP is stubbed by setting an Application env to a Plug
function — see `req-http.md`. No Bypass, no Mox.

## LiveView tests

Use `Phoenix.LiveViewTest` directly: `live/2`, `render_submit/2`,
`render_change/2`, `assert_redirected/2`. No `phoenix_test` wrapper —
the native API is sufficient and ages well.
