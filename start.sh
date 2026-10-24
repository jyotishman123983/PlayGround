#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d node_modules ] && [ -f package-lock.json ]; then
  /usr/bin/time -p npm ci --omit=dev --no-audit --no-fund || echo "[start] npm ci failed; continuing with built-in modules only" >&2
fi

exec node server.mjs
