# Req HTTP clients

## Use `Req` for every external HTTP call

Not `:httpc`, not HTTPoison, not Tesla, not Finch directly. Req is the
default. Its config-as-options model and built-in plug seam (see
below) make it both more ergonomic and more testable than alternatives.

## One thin module per integration

Wrap each external API in its own module — `Myapp.Mail.Resend`,
`Myapp.Sprite.Api`, `Myapp.Turnstile`. Public functions match the
domain ("send_verification_code", "create_sprite") and return tagged
tuples (`:ok`, `{:ok, payload}`, `{:error, reason}`). Callers never
import Req; they call the integration module.

## Fail-open in dev when credentials are missing

If the integration's API key isn't set, the function logs and returns
`:ok` (or a sensible default) instead of crashing. Lets local dev and
the test suite run without external services configured:

    def send_verification_code(email, code) do
      case Application.get_env(:myapp, :resend_api_key) do
        nil ->
          Logger.info("[Mail.Resend] no API key; code for #{email}: #{code}")
          :ok
        key ->
          post_email(key, email, code)
      end
    end

This applies to non-critical integrations — email, analytics, error
reporters. For credentials whose absence should be loud (the main
database URL), fail loudly via `System.fetch_env!/1`.

## Test seam: a `:plug` option, not a mocking library

Req's `:plug` option swaps the HTTP transport for any Plug-compatible
function. Tests stub by setting an Application env var; production
ignores it:

    defp post_email(key, email, code) do
      opts =
        [json: body, auth: {:bearer, key}]
        |> maybe_with_plug()

      Req.post(base_url() <> "/emails", opts) |> handle_response()
    end

    defp maybe_with_plug(opts) do
      case Application.get_env(:myapp, :resend_req_plug) do
        nil -> opts
        plug -> Keyword.put(opts, :plug, plug)
      end
    end

In tests:

    Application.put_env(:myapp, :resend_req_plug, fn conn ->
      Plug.Conn.send_resp(conn, 200, ~s({"id": "test"}))
    end)
    on_exit(fn -> Application.delete_env(:myapp, :resend_req_plug) end)

    assert :ok = Mail.send_verification_code("a@b.com", "123456")

No Bypass, no Mox, no library. The plug *is* the seam.

## Response handling

Match on `Req.Response` status to convert HTTP outcomes into domain
results. Log on failure so debugging an outage doesn't require reaching
into a separate observability tool first:

    case Req.post(url, opts) do
      {:ok, %Req.Response{status: status}} when status in 200..299 ->
        :ok

      {:ok, %Req.Response{status: status, body: body}} ->
        Logger.error("[Integration] returned #{status}: #{inspect(body)}")
        {:error, {:http, status}}

      {:error, reason} ->
        Logger.error("[Integration] transport error: #{inspect(reason)}")
        {:error, reason}
    end
