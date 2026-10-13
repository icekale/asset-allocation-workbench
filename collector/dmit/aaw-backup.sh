#!/usr/bin/env bash
# Daily AAW backup on DMIT (Asia/Shanghai). Encrypts secrets with age; keeps 14 daily copies.
# Usage: aaw-backup.sh [--restore <archive.tgz.age>] [--list]
set -euo pipefail
export TZ=Asia/Shanghai
ROOT="${AAW_ROOT:-/root/aaw}"
DEST="${AAW_BACKUP_DIR:-/var/backups/aaw}"
KEEP="${AAW_BACKUP_KEEP:-14}"
AGE_KEY="${AAW_AGE_KEY:-/root/.config/aaw-backup/age.key}"
AGE_PUB="${AAW_AGE_PUB:-$ROOT/config/aaw-backup-age.pubkey}"
STAMP=$(date +%Y%m%d-%H%M%S)
WORKDIR=$(mktemp -d /tmp/aaw-backup.XXXXXX)
trap 'rm -rf "$WORKDIR"' EXIT

need() { command -v "$1" >/dev/null || { echo "missing $1" >&2; exit 1; }; }
need tar; need age; need sha256sum

ensure_age_key() {
  if [[ ! -f "$AGE_KEY" ]]; then
    mkdir -p "$(dirname "$AGE_KEY")"
    umask 077
    age-keygen -o "$AGE_KEY" >/dev/null
    chmod 600 "$AGE_KEY"
  fi
  local pub
  pub=$(age-keygen -y "$AGE_KEY")
  mkdir -p "$(dirname "$AGE_PUB")"
  if [[ ! -f "$AGE_PUB" ]] || ! grep -qxF "$pub" "$AGE_PUB" 2>/dev/null; then
    printf '%s\n' "$pub" >"$AGE_PUB"
    chmod 644 "$AGE_PUB"
  fi
}

backup() {
  ensure_age_key
  mkdir -p "$DEST" "$WORKDIR/bundle"
  # Plain data (no secrets)
  mkdir -p "$WORKDIR/bundle/data" "$WORKDIR/bundle/d1" "$WORKDIR/bundle/output" "$WORKDIR/bundle/meta"
  if [[ -d "$ROOT/app/data" ]]; then
    rsync -a --exclude='.dev.vars*' --exclude='.env*' "$ROOT/app/data/" "$WORKDIR/bundle/data/"
  fi
  # Local Miniflare D1 sqlite
  local d1="$ROOT/.wrangler/state/v3/d1/miniflare-D1DatabaseObject"
  if [[ -d "$d1" ]]; then
    rsync -a "$d1/" "$WORKDIR/bundle/d1/"
  fi
  # Evidence / decision / alerts logs under output
  for f in stale-check.json source-health.json alerts.json collector-last-run.json; do
    [[ -f "$ROOT/output/$f" ]] && cp -a "$ROOT/output/$f" "$WORKDIR/bundle/output/"
  done
  # Confirmations if present
  [[ -f "$ROOT/app/data/macro-rating-confirmations.json" ]] || true
  # Secrets: encrypt individually with age (never plaintext in the archive name that goes off-host without age)
  mkdir -p "$WORKDIR/bundle/secrets"
  for sec in .dev.vars .env.caixin .collector.env; do
    if [[ -f "$ROOT/$sec" ]]; then
      age -r "$(cat "$AGE_PUB")" -o "$WORKDIR/bundle/secrets/${sec}.age" "$ROOT/$sec"
    fi
  done
  printf '%s\n' "createdAt=$STAMP" "host=$(hostname)" "root=$ROOT" "git=$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)" \
    "branch=$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)" >"$WORKDIR/bundle/meta/MANIFEST.txt"
  (cd "$WORKDIR/bundle" && tar -czf "$WORKDIR/plain.tgz" .)
  age -r "$(cat "$AGE_PUB")" -o "$DEST/aaw-$STAMP.tgz.age" "$WORKDIR/plain.tgz"
  sha256sum "$DEST/aaw-$STAMP.tgz.age" | awk '{print $1}' >"$DEST/aaw-$STAMP.tgz.age.sha256"
  # Prune to KEEP newest
  ls -1t "$DEST"/aaw-*.tgz.age 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
    rm -f "$old" "${old}.sha256"
  done
  # Off-host push hook (optional): AAW_OFFSITE_CMD must be a full command that receives the archive path as $1
  if [[ -n "${AAW_OFFSITE_CMD:-}" ]]; then
    # shellcheck disable=SC2086
    eval "$AAW_OFFSITE_CMD" "$DEST/aaw-$STAMP.tgz.age" || echo "offsite push failed (local backup kept)" >&2
  else
    echo "offsite: skipped (set AAW_OFFSITE_CMD to enable push)"
  fi
  echo "backup ok $DEST/aaw-$STAMP.tgz.age"
  ls -1t "$DEST"/aaw-*.tgz.age | wc -l | awk '{print "kept",$1,"archives"}'
}

restore() {
  local arch="${1:?archive path}"
  local out="${2:-$WORKDIR/restore}"
  ensure_age_key
  mkdir -p "$out"
  age -d -i "$AGE_KEY" -o "$WORKDIR/restored.tgz" "$arch"
  tar -xzf "$WORKDIR/restored.tgz" -C "$out"
  # Verify secrets decrypt
  if [[ -f "$out/secrets/.dev.vars.age" ]]; then
    age -d -i "$AGE_KEY" -o "$WORKDIR/.dev.vars.check" "$out/secrets/.dev.vars.age"
    sha256sum "$WORKDIR/.dev.vars.check" "$ROOT/.dev.vars" 2>/dev/null || true
    rm -f "$WORKDIR/.dev.vars.check"
  fi
  echo "restore ok -> $out"
  ls "$out"
  test -f "$out/meta/MANIFEST.txt"
  test -d "$out/data"
}

list_archives() { ls -lh "$DEST"/aaw-*.tgz.age 2>/dev/null || echo "(none)"; }

case "${1:-backup}" in
  backup) backup ;;
  --list|list) list_archives ;;
  --restore|restore) restore "${2:?}" "${3:-}" ;;
  *) echo "usage: $0 [backup|--list|--restore <file> [outdir]]" >&2; exit 2 ;;
esac
