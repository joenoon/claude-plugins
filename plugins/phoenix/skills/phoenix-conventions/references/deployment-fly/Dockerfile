# Production multi-stage Dockerfile template for a Phoenix release.
#
# Assets use mix-managed esbuild + tailwind (no npm).
#
# Substitute `myapp` with your actual application name (the OTP app name
# / release name). Image tags should be kept current — see:
#   https://hub.docker.com/r/hexpm/elixir/tags
#   https://hub.docker.com/_/ubuntu?tab=tags

ARG BUILDER_IMAGE="hexpm/elixir:1.19.5-erlang-27.3.4.6-ubuntu-noble-20260113"
ARG RUNNER_IMAGE="ubuntu:noble"


### [builder] - Compiles the Phoenix release

FROM ${BUILDER_IMAGE} AS builder

RUN apt-get update -y && apt-get install -y git ca-certificates \
  && apt-get clean && rm -f /var/lib/apt/lists/*_*

# If you have NIFs that need C build tools, append `build-essential cmake`
# (or whatever the lib documents) to the apt-get install above.

WORKDIR /app

RUN mix local.hex --force && \
  mix local.rebar --force

ENV MIX_ENV="prod"

COPY mix.exs mix.lock ./
RUN mix deps.get --only $MIX_ENV
RUN mkdir config

# Compile-time config files before deps so config changes invalidate the
# dep-compile cache.
COPY config/config.exs config/${MIX_ENV}.exs config/
RUN mix deps.compile

COPY priv priv
COPY assets assets
COPY lib lib

# Compile first so the LiveView compiler emits phoenix-colocated/<app>/
# before esbuild bundles assets.
RUN mix compile
RUN mix assets.deploy

# runtime.exs is read at boot — copy AFTER compile so secret changes
# don't invalidate the BEAM bytecode layer.
COPY config/runtime.exs config/

COPY rel rel
RUN mix release

### [runner_base] - Minimal runtime image with postgres-client (handy for ops)

FROM ${RUNNER_IMAGE} AS runner_base

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends \
     curl ca-certificates wget gnupg2 software-properties-common \
     libstdc++6 openssl libncurses6 locales tini procps lsb-release \
  && sh -c 'echo "deb https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list' \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add - \
  && apt-get update -y \
  && apt-get install -y --no-install-recommends postgresql-client-17 libpq-dev \
  && apt-get clean && rm -f /var/lib/apt/lists/*_*

RUN sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen

ENV LANG=en_US.UTF-8
ENV LANGUAGE=en_US:en
ENV LC_ALL=en_US.UTF-8

### [release] - Final production image

FROM runner_base

WORKDIR "/app"
RUN chown nobody /app

COPY --from=builder --chown=nobody:root /app/_build/prod/rel/myapp ./

RUN usermod -d /app nobody && chsh -s /bin/bash nobody

ARG APP_REVISION=""
ENV APP_REVISION=${APP_REVISION}

USER nobody

ENTRYPOINT ["tini", "--"]
CMD ["/app/bin/server"]
