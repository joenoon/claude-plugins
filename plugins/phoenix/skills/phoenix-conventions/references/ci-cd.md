# CI/CD (GitHub Actions + Fly)

## Template files

Two workflows under `references/ci-cd/`, ready to copy into
`.github/workflows/`:

- `preview.yml` — per-PR ephemeral Fly app + (optional) branched DB.
- `release.yml` — branch-push deploys + auto-tagging.

The templates use placeholders (`myapp`, `your-app.example.com`) —
edit Fly app name, hostname, and any provider-specific integrations
before use.

## Preview apps: one per PR, torn down on close

`preview.yml` fires on `pull_request` events:

- Creates a per-PR Fly app named `myapp-pr-<N>`.
- **(Optional, if using Neon)** Creates or reuses a per-PR Neon
  database branch `preview-pr-<N>` off a preview-seed project, so
  each preview has its own data and can be migrated without touching
  prod. The template marks the Neon steps with `=== Neon-specific
  ===` blocks; on a different Postgres provider (Supabase, Aiven,
  bare RDS, local), replace or drop those steps — Claude can work
  out the equivalent for whatever you're on.
- **Derives `SECRET_KEY_BASE` and `RELEASE_COOKIE` from the PR
  number**. `SECRET_KEY_BASE` appends `+pr-N` to a long
  `PREVIEW_SECRET_BASE` repo secret; `RELEASE_COOKIE` is
  `preview-pr-N`. Stable across re-pushes to the same PR — no
  logout-every-deploy — but different per PR so cookies don't leak
  between previews.
- Sets `PHX_HOST` per-PR via Fly secrets (overriding the production
  default in `fly.toml`).
- Comments a sticky preview URL on the PR.
- Tears down the Fly app + DB branch when the PR closes.

## Release: push a branch, not a tag

`release.yml` deploys what's at `release-prod`. Two-line workflow for
the operator:

    # Deploy current HEAD:
    git push origin +HEAD:release-prod

    # Roll back to an older SHA:
    git push origin +<older-sha>:release-prod

The branch tip is the release. No `mix.exs` `@version` bumps; no
semver; no manual tag-and-push dance.

After a successful deploy the workflow:

1. Polls the public URL for HTTP 200 (30 attempts, 5s apart). Fails
   the job if the deploy never serves 200.
2. Creates an immutable `prod-YYYY-MM-DD-<short-sha>` tag.
3. Creates a GH Release with auto-generated notes from the previous
   `prod-*` tag, for forensic provenance — the branch points at
   "what's deployed now," tags answer "what was deployed when."

If the same SHA is re-deployed, the tag step detects an existing tag
and skips it. No duplicates.

## No semantic versioning

Skip `mix.exs` `@version` bumps. The deployed commit's SHA *is* the
version; the `prod-*` tag preserves the deploy timestamp. Versions
only matter when you publish a library — for an application, they're
an extra coordination step you don't need.
