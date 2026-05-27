# LiveView idioms

## Async data fetching: `assign_async/3` by default

`assign_async/3` handles the full lifecycle — loading, ok, failed — and
wraps the result in `Phoenix.LiveView.AsyncResult` automatically. The
function returns `{:ok, %{key: value}}` (keys must match what you passed to
`assign_async`) or `{:error, reason}`:

    def mount(_params, _session, socket) do
      {:ok,
        socket
        |> assign(:user_id, user_id)
        |> assign_async(:projects, fn -> {:ok, %{projects: Billing.list_projects(user_id)}} end)}
    end

Render the three states via the `<.async_result>` component (or by checking
`@projects.loading`, `@projects.ok?`, `@projects.result` directly):

    <.async_result :let={projects} assign={@projects}>
      <:loading>Loading projects…</:loading>
      <:failed :let={reason}>Failed: {inspect(reason)}</:failed>
      <ul>
        <li :for={p <- projects}>{p.name}</li>
      </ul>
    </.async_result>

Loading is a UI state. Render it, don't hide it.

## When to reach for `start_async/3` instead

Use `start_async/3` + `handle_async/3` when `assign_async`'s "just store
the result" model isn't enough — when you need to update other assigns
based on the result, track multiple in-flight tasks, or implement dedup
(see below).

## In-flight dedup with a `MapSet`

For preventing double-submits without disabling the button:

    # in mount:
    socket = assign(socket, :in_flight, MapSet.new())

    def handle_event("delete", %{"id" => id}, socket) do
      if MapSet.member?(socket.assigns.in_flight, id) do
        {:noreply, socket}
      else
        socket = assign(socket, :in_flight, MapSet.put(socket.assigns.in_flight, id))
        {:noreply, start_async(socket, {:delete, id}, fn -> Billing.delete(id) end)}
      end
    end

    def handle_async({:delete, id}, {:ok, _}, socket) do
      {:noreply, assign(socket, :in_flight, MapSet.delete(socket.assigns.in_flight, id))}
    end

    def handle_async({:delete, id}, {:exit, _reason}, socket) do
      {:noreply, assign(socket, :in_flight, MapSet.delete(socket.assigns.in_flight, id))}
    end

## PubSub: subscribe in `mount`, guarded by `connected?/1`

LiveView mounts twice — dead render, then connected. Subscribe only on the
connected mount to avoid leaking subscriptions across mounts:

    def mount(%{"id" => id}, _session, socket) do
      if connected?(socket) do
        Phoenix.PubSub.subscribe(Myapp.PubSub, "thing:#{id}")
      end
      {:ok, assign(socket, :id, id)}
    end

## PubSub: topics are namespaced strings; broadcast from contexts

One PubSub instance (`{Phoenix.PubSub, name: Myapp.PubSub}`). Topics are
colon-namespaced:

- `"user:#{user_id}"` — user-scoped events
- `"thing:#{thing_id}"` — entity-scoped events
- `"thing:#{thing_id}:progress"` — sub-channel for one concern

Broadcasting goes through the context (`Myapp.Things.broadcast_update/1`).
Subscribing only happens in LiveViews — contexts don't subscribe to
themselves.

Message shape is **always** a tagged tuple, never a raw map:

    Phoenix.PubSub.broadcast(Myapp.PubSub, "thing:#{thing.id}", {:thing_updated, thing})

Receivers pattern-match in `handle_info/2`:

    def handle_info({:thing_updated, thing}, socket) do
      {:noreply, assign(socket, :thing, thing)}
    end

Tagged tuples mean every message has an identifiable shape; you can grep
for senders/receivers of `:thing_updated` and never wonder which map key
held what.

## Suppress password managers on LiveView inputs by default

1Password / Bitwarden / LastPass inject hidden fields into rendered inputs.
LiveView's morphdom patching treats those injections as unexpected DOM and
either drops them on the next patch (annoying users) or trips up the diff
entirely. The fix is to mark inputs as opt-out for password managers by
default — add `data-1p-ignore`, `data-lpignore`, `data-bwignore` to every
`<input>` and `<textarea>` your app renders, and opt back in per-element
with `data-pm-allow="true"` only on the inputs that genuinely want
password-manager interaction (login email, account password change).

This is a quiet bug source for anyone shipping LiveView UIs; address it
once at the component layer (typically in `<.input>`) rather than
debugging morphdom mysteries later.

## Forms: changeset-backed, even for non-persisted inputs

Wrap form-only inputs (search filters, modal forms, command intents) in
an Ecto `embedded_schema` changeset. Same `to_form/2` + `<.input>` flow as
schema-backed forms, with real `cast`, `validate_*`, error display — and
the freedom to shape inputs differently from any persisted resource:

    defmodule MyappWeb.SearchForm do
      use Ecto.Schema
      import Ecto.Changeset

      embedded_schema do
        field :q, :string
        field :scope, :string, default: "all"
      end

      def changeset(form \\ %__MODULE__{}, params) do
        form
        |> cast(params, [:q, :scope])
        |> validate_inclusion(:scope, ~w(all mine archived))
      end
    end

In the LiveView:

    def mount(_params, _session, socket) do
      {:ok, assign(socket, :search_form, to_form(SearchForm.changeset(%{})))}
    end

    def handle_event("validate", %{"search_form" => params}, socket) do
      changeset = SearchForm.changeset(params) |> Map.put(:action, :validate)
      {:noreply, assign(socket, :search_form, to_form(changeset))}
    end

Plain `to_form(%{}, as: :key)` is the rare exception — only for inputs
that need zero validation.
