# Ecto and contexts

## Repo migration defaults (in `config.exs`)

Set Repo-wide migration defaults once so generated migrations and
generated schemas emit the right columns and types:

    config :myapp,
      generators: [timestamp_type: :utc_datetime]

    config :myapp, Myapp.Repo,
      migration_primary_key: [
        name: :id,
        type: :binary_id,
        default: {:fragment, "gen_random_uuid()"}
      ],
      migration_foreign_key: [type: :binary_id],
      migration_timestamps: [type: :timestamptz],
      migration_lock: :pg_advisory_lock

- `gen_random_uuid()` DB-side default: every row gets a UUID even if
  something bypasses Ecto and inserts via raw SQL.
- `:timestamptz` Postgres column type — microsecond precision,
  timezone-aware.
- `:pg_advisory_lock` is the Ecto SQL default; setting it explicitly
  documents intent.

## Base schema macro

Every schema uses `use Myapp.Schema`, which sets the Elixir-side
counterparts to the migration defaults:

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

`autogenerate: true` lets Ecto generate the UUID before insert. Paired
with the DB-side `gen_random_uuid()` default, the column is always
populated whether Ecto inserts or raw SQL does. `:utc_datetime_usec`
matches the microsecond resolution of the `:timestamptz` column.

Why binary_id everywhere: UUIDs hide row counts from URLs and make
merging data across environments safer. Microsecond timestamps sort
correctly when two rows land in the same millisecond.

## Soft-delete via timestamp, never via boolean

State columns are timestamps, not booleans: `consumed_at`, `archived_at`,
`cancelled_at`, `verified_at`. Two reasons:

- You preserve *when* the state changed — useful for audits, support
  tickets, and "what was the state at time T" queries.
- Scopes read naturally: `where: is_nil(c.archived_at)` is "the active
  set"; no `where: c.archived == false` confusion about defaults.

Use booleans only when there's no temporal meaning (e.g., a feature
toggle).

## One Repo

A single `Myapp.Repo`. No per-context Repo modules. If a context grows so
big it wants its own database, the answer is usually a new app or
service, not a second Repo in the same OTP application.
