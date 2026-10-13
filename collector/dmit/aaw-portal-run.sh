#!/bin/bash
# Run AAW portal from vinext production build via wrangler (Miniflare).
# Plain `vinext start` cannot resolve cloudflare:workers; this serves dist/ without Vite HMR.
#
# D1 / Miniflare state MUST persist outside dist/: npm run build recreates dist/server and
# would wipe any .wrangler/state nested there back to empty → seed asOf 2026-07-28.
set -euo pipefail
cd /root/aaw
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}"
export WRANGLER_LOG_PATH="${WRANGLER_LOG_PATH:-.wrangler/wrangler.log}"
export TZ=Asia/Shanghai
PERSIST="${AAW_WRANGLER_PERSIST:-/var/lib/aaw/wrangler-state}"
mkdir -p "$PERSIST"
# Ensure runtime secrets for local Worker bindings (never commit)
ln -sfn /root/aaw/.dev.vars /root/aaw/dist/server/.dev.vars
exec ./node_modules/.bin/wrangler dev \
  --config dist/server/wrangler.json \
  --port 8788 \
  --ip ::1 \
  --local \
  --persist-to "$PERSIST"
