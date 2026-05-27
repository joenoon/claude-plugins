# Oban

## Config

    # config/config.exs
    config :myapp, Oban,
      engine: Oban.Engines.Basic,
      notifier: Oban.Notifiers.PG,
      queues: [default: 10, mail: 5, state_poller: 5, provisioner: 4],
      repo: Myapp.Repo

    # lib/myapp/application.ex
    children = [
      Myapp.Repo,
      MyappWeb.Endpoint,
      {Oban, Application.fetch_env!(:myapp, Oban)}
    ] ++ kickoff()

    defp kickoff do
      if Application.get_env(:myapp, :env) == :test, do: [], else: [Myapp.Kickoff]
    end

Name queues by the concern they serve, not by priority — `:mail`,
`:provisioner`, `:state_poller`. When a queue backs up, you can tell at
a glance what work is stuck. `Myapp.Kickoff` is covered below.

## Mount the web dashboard at `/phx/oban`

Inside the admin scope (see `router-and-auth.md`):

    import Oban.Web.Router
    oban_dashboard "/oban"

## Worker pattern: coalescing dedup with `unique`

When many enqueues should collapse to one in-flight job, use `unique`
keyed by the dedup dimension:

    use Oban.Worker,
      queue: :default,
      unique: [keys: [:user_id], period: 60]

Within `period` seconds, a second enqueue with the same `user_id` is a
no-op rather than a duplicate job.

For "one in-flight per key, forever" semantics, use `period: :infinity`
and restrict to active states so dedup releases when the job finishes:

    use Oban.Worker,
      queue: :state_poller,
      unique: [
        keys: [:sprite_id],
        period: :infinity,
        states: [:available, :scheduled, :retryable, :executing]
      ]

## Prefer `{:snooze, n}` over Oban Cron

For "watch this resource until something changes" or "tick every N
seconds while this thing is active," return `{:snooze, n}` from
`perform/1` instead of registering an Oban Cron schedule. The job
self-manages its cadence and stops naturally when the condition is
reached:

    def perform(%Oban.Job{args: %{"sprite_id" => id}}) do
      if Sprites.has_watchers?(id) do
        Sprites.snapshot_and_broadcast(id)
        {:snooze, 30}
      else
        :ok
      end
    end

`:ok` ends the loop. No phantom runs when no work is needed; no
external schedule to keep in sync with code; cadence can vary per
iteration.

Reach for `Oban.Plugins.Cron` only when you genuinely want a fixed
wall-clock schedule with no relationship to application state (e.g.,
"send a weekly digest every Monday at 9am UTC").

## Worker `ping!/N`: idempotent enqueue

Each perpetual worker — sweepers, snooze-based loops, periodic checkers
— exposes a `ping!/N` function that inserts a job idempotently. The
`unique` constraint on the worker collapses repeated calls into a
single queued job:

    def ping! do
      %{}
      |> __MODULE__.new(schedule_in: 1)
      |> Oban.insert()
    end

    # per-key loops take the key:
    def ping!(sprite_id) do
      %{sprite_id: sprite_id}
      |> __MODULE__.new(schedule_in: 1)
      |> Oban.insert()
    end

Callers say `Worker.ping!(...)`. They never construct an Oban job by
hand.

## App-level `Kickoff`: boot perpetual loops on startup

A `Myapp.Kickoff` module sits in the supervision tree as a one-shot
boot step. It pings every perpetual worker once on startup; the
`unique` constraint on each worker means restarts and multi-node
deploys don't create duplicates:

    defmodule Myapp.Kickoff do
      def child_spec(_opts) do
        %{
          id: __MODULE__,
          start: {__MODULE__, :start_link, []},
          type: :worker,
          restart: :temporary,
          shutdown: 500
        }
      end

      def start_link do
        Myapp.Workers.SweepStaleSessions.ping!()
        Myapp.Workers.RenewCertificates.ping!()
        Myapp.Workers.NotifySnapshotEnd.ping!()
        # ... one ping! per perpetual worker

        :ignore
      end
    end

`start_link` returning `:ignore` tells the supervisor to skip storing
it as a child — Kickoff runs its setup and exits cleanly. `restart:
:temporary` ensures the supervisor won't loop-restart it if it ever
does crash.

When you add a new perpetual worker, add one line to `start_link`.
Single place that lists "what loops should always be running."

## Fast-forward an existing loop with `replace:`

When a user action should slide a queued job's `scheduled_at` forward
(instead of waiting for the next snooze tick), insert with `replace:`:

    def kick(sprite_id, opts \\ []) do
      delay = Keyword.get(opts, :delay, 1)

      %{sprite_id: sprite_id}
      |> __MODULE__.new(
        schedule_in: delay,
        replace: [scheduled: [:scheduled_at], available: [:scheduled_at]]
      )
      |> Oban.insert()
    end

`replace: [scheduled: [:scheduled_at], available: [:scheduled_at]]`
means: if a job is already queued in `scheduled` or `available` state
for this unique key, slide its `scheduled_at` to the new value instead
of inserting a duplicate.
