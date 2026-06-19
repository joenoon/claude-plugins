#!/usr/bin/env bash
# One-shot setup for the headless-browser verify tooling. Run once per machine
# (persisted by a Sprite checkpoint thereafter). Installs Playwright, Chromium,
# and the system libs Chromium needs.
set -euo pipefail
cd "$(dirname "$0")"

npm install

# Browser binary (lands in ~/.cache/ms-playwright; shared across projects).
./node_modules/.bin/playwright install chromium

# System libs via apt. `sudo` drops node from PATH, so pass the current PATH
# through `env` or the playwright shebang (#!/usr/bin/env node) can't resolve.
sudo env "PATH=$PATH" ./node_modules/.bin/playwright install-deps chromium

echo
echo "Done. Start your dev server (e.g. PORT=8080 mix phx.server), then:"
echo "  node bin/browser/shot.mjs /                          # a public page"
echo "  AUTH_EMAIL=<dev-user> node bin/browser/shot.mjs /dashboard --auth"
