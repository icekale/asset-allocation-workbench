#!/bin/bash
# Asset-allocation workbench collector wrapper (DMIT).
# Modes: audit | audit-light | apply | stale | caixin
# Scheduled apply writes app/data (not D1/ratings) and restarts portal when data may have changed.
set -uo pipefail
export TZ=Asia/Shanghai
AAW=/root/aaw
cd "$AAW" || exit 1
export CAIXIN_ENV_FILE=.env.caixin
export COLLECTOR_LAST_RUN="$AAW/output/collector-last-run.json"
MODE="${AAW_MODE:-audit}"
LOG_DIR=/var/log/aaw
mkdir -p "$LOG_DIR" "$AAW/output"
STAMP=$(date +%Y%m%d-%H%M%S)
LOG="$LOG_DIR/collector-${MODE}-${STAMP}.log"
NODE=$(command -v node)
code=0

restart_portal() {
  echo "=== restarting aaw-portal (+ sock/edge) at $(date -Is) ==="
  systemctl restart aaw-portal.service
  # sock re-binds unix socket and restarts docker aaw-edge (inode refresh)
  systemctl restart aaw-portal-sock.service
  # TCP proxies reconnect via Restart=always; nudge them too for clean sockets
  systemctl reset-failed aaw-portal-proxy.service aaw-portal-proxy-docker0.service >/dev/null 2>&1 || true
  systemctl try-restart aaw-portal-proxy.service aaw-portal-proxy-docker0.service >/dev/null 2>&1 || true
  # wait for wrangler/workerd readiness (prod cold start)
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 1 "http://[::1]:8788/" 2>/dev/null | grep -q 200; then
      echo "=== portal ready after ${i}s ==="
      break
    fi
    sleep 1
  done
  systemctl is-active aaw-portal.service aaw-portal-sock.service aaw-portal-proxy.service aaw-portal-proxy-docker0.service || true
}

data_mtime() {
  find "$AAW/app/data" -type f -printf '%T@\n' 2>/dev/null | sort -n | tail -1
}

prune_logs() {
  # Keep recent collector logs; rotate oversized portal log.
  find "$LOG_DIR" -maxdepth 1 -type f -name 'collector-*.log' -mtime +45 -delete 2>/dev/null || true
  find "$LOG_DIR" -maxdepth 1 -type f -name 'vinext-*.log' -mtime +30 -delete 2>/dev/null || true
  if [ -f "$LOG_DIR/vinext-prod.log" ]; then
    local size
    size=$(wc -c <"$LOG_DIR/vinext-prod.log" 2>/dev/null || echo 0)
    if [ "${size:-0}" -gt 20971520 ]; then
      mv -f "$LOG_DIR/vinext-prod.log" "$LOG_DIR/vinext-prod.log.1" 2>/dev/null || true
      : >"$LOG_DIR/vinext-prod.log"
    fi
  fi
}

{
  echo "=== aaw collector mode=$MODE at $(date -Is) ==="
  case "$MODE" in
    audit)
      "$NODE" --experimental-strip-types scripts/collector-run.mjs --mode=audit || code=$?
      ;;
    audit-light)
      "$NODE" --experimental-strip-types scripts/collector-run.mjs --mode=audit --skip-collectors || code=$?
      ;;
    apply)
      # Soft-stale (official lag) must not fail cron; hard collector failure still exit 1.
      # Transient soft collectors (e.g. GDP SDDS) exit 0 from refresh-official-macro.
      before=$(data_mtime)
      "$NODE" --experimental-strip-types scripts/collector-run.mjs --mode=apply --fail-on-stale=false || code=$?
      after=$(data_mtime)
      changed=0
      if [ -n "${before:-}" ] && [ -n "${after:-}" ] && [ "$before" != "$after" ]; then
        changed=1
      elif [ -z "${before:-}" ] && [ -n "${after:-}" ]; then
        changed=1
      fi
      # Semi-automatic macro rating: draft only (frozen rules), never publishes.
      echo "=== macro rating draft ==="
      timeout 1800 "$NODE" scripts/collect-rating-evidence.mjs || echo "=== rating evidence collection FAILED (draft uses previous evidence) ==="
      timeout 2400 "$NODE" scripts/collect-judgement-evidence.mjs --browserLimit=15 --attachLimit=20 || echo "=== judgement evidence collection FAILED (suggestions use previous evidence) ==="
      "$NODE" scripts/macro-rating-draft.mjs build || echo "=== macro rating draft FAILED ==="
      "$NODE" scripts/source-health.mjs || echo "=== source-health FAILED ==="
      if [ -f "$AAW/output/macro-rating-draft-notable.json" ]; then
        echo "=== NOTABLE macro rating change: $(cat "$AAW/output/macro-rating-draft-notable.json" | tr -d "\n") ==="
      fi
      echo "=== apply finished exit=$code data_changed=$changed before_mtime=${before:-none} after_mtime=${after:-none} ==="
      # Restart when apply succeeded, or when app/data mtimes moved (partial write).
      if [ "$code" -eq 0 ] || [ "$changed" -eq 1 ]; then
        restart_portal
      else
        echo "=== skip portal restart (apply exit=$code, no data mtime change) ==="
      fi
      ;;
    stale)
      "$NODE" --experimental-strip-types scripts/stale-check.mjs "$AAW/output/stale-check.json" || code=$?
      "$NODE" scripts/source-health.mjs || true
      ;;
    caixin)
      "$NODE" --experimental-strip-types scripts/caixin-audit.mjs "$AAW/output/caixin-whitelist-audit.json" || code=$?
      ;;
    *)
      echo "unknown AAW_MODE=$MODE" >&2
      code=1
      ;;
  esac
  echo "=== done exit=$code at $(date -Is) ==="
} >>"$LOG" 2>&1

# IMPORTANT: do not `exit` inside the `{ }` group above — that skipped this symlink.
ln -sfn "$LOG" "$LOG_DIR/collector-last.log"
prune_logs
exit "$code"
