#!/bin/bash
# AAW Shanghai-index refresh for DMIT local portal (wrangler --local D1).
# Updates asOf/index/collectedAt via POST /api/update; does NOT change factors/ratings.
# Cron: weekdays 15:10 Asia/Shanghai (matches CF Worker cron 10 7 * * 1-5 UTC).
set -uo pipefail
export TZ=Asia/Shanghai
AAW=/root/aaw
cd "$AAW" || exit 1
LOG_DIR=/var/log/aaw
mkdir -p "$LOG_DIR" "$AAW/collector" "$AAW/output"
STAMP=$(date +%Y%m%d-%H%M%S)
LOG="$LOG_DIR/index-refresh-${STAMP}.log"
NODE=$(command -v node)
code=0

# Prefer .collector.env; otherwise derive from .dev.vars (UPDATE_TOKEN) + local portal.
ensure_collector_env() {
  if [ -f "$AAW/.collector.env" ] && grep -q '^UPDATE_TOKEN=' "$AAW/.collector.env" && grep -q '^SITE_URL=' "$AAW/.collector.env"; then
    return 0
  fi
  if [ ! -f "$AAW/.dev.vars" ]; then
    echo "missing .dev.vars and .collector.env" >&2
    return 1
  fi
  local token
  token=$(grep '^UPDATE_TOKEN=' "$AAW/.dev.vars" | head -1 | cut -d= -f2-)
  if [ -z "$token" ]; then
    echo "UPDATE_TOKEN missing in .dev.vars" >&2
    return 1
  fi
  umask 077
  cat > "$AAW/.collector.env" <<ENVEOF
SITE_URL=http://[::1]:8788
UPDATE_TOKEN=$token
ENVEOF
  chmod 600 "$AAW/.collector.env"
}

wait_portal() {
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 1 "http://[::1]:8788/api/health" 2>/dev/null | grep -q 200; then
      return 0
    fi
    sleep 1
  done
  return 1
}

prune_logs() {
  find "$LOG_DIR" -maxdepth 1 -type f -name 'index-refresh-*.log' -mtime +45 -delete 2>/dev/null || true
}

{
  echo "=== aaw index-refresh at $(date -Is) ==="
  if ! ensure_collector_env; then
    code=1
  elif ! wait_portal; then
    echo "portal not ready on [::1]:8788" >&2
    code=1
  else
    export COLLECTOR_ENV_FILE="$AAW/.collector.env"
    # Merge quote into baseline from local /api/update and publish back to local D1.
    "$NODE" --experimental-strip-types scripts/refresh-index.mjs --publish --output=collector/latest-payload.json || code=$?
    echo "=== health after refresh ==="
    curl -sS -m 10 "http://[::1]:8788/api/health" || true
    echo
  fi
  echo "=== done exit=$code at $(date -Is) ==="
} >>"$LOG" 2>&1

ln -sfn "$LOG" "$LOG_DIR/index-refresh-last.log"
prune_logs
exit "$code"
