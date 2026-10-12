#!/usr/bin/env bash
# 安装并加载本仓库的定时任务：把 launchd/*.plist 中的占位路径替换为本机实际路径，
# 写入 ~/Library/LaunchAgents 并用 launchctl 载入。
#
#   bash scripts/install-launchd.sh              # 安装全部
#   bash scripts/install-launchd.sh index-refresh # 只装指数行情兜底
#   NODE_BIN=/path/to/node bash scripts/install-launchd.sh
#
# 卸载：launchctl bootout gui/$UID/com.asset-allocation.index-refresh
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENTS_DIR="$HOME/Library/LaunchAgents"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
PYTHON_BIN="${PYTHON:-$(command -v python3 || true)}"
FILTER="${1:-}"

if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  printf 'Node.js not found. Re-run with NODE_BIN=/absolute/path/to/node.\n' >&2
  exit 1
fi

mkdir -p "$AGENTS_DIR"
shopt -s nullglob

installed=0
for template in "$PROJECT_ROOT"/launchd/com.asset-allocation.*.plist; do
  name="$(basename "$template")"
  if [[ -n "$FILTER" && "$name" != *"$FILTER"* ]]; then
    continue
  fi
  target="$AGENTS_DIR/$name"
  sed -e "s|/ABSOLUTE/PATH/TO/node|$NODE_BIN|g" \
      -e "s|/ABSOLUTE/PATH/TO/asset-allocation-protected-site|$PROJECT_ROOT|g" \
      -e "s|/ABSOLUTE/PATH/TO/python3|$PYTHON_BIN|g" \
      -e "s|/ABSOLUTE/PATH/TO|$PROJECT_ROOT|g" "$template" > "$target"
  launchctl bootout "gui/$UID/$name" 2>/dev/null || true
  launchctl bootstrap "gui/$UID" "$target"
  printf 'loaded %s -> %s\n' "$name" "$target"
  installed=$((installed + 1))
done

if [[ "$installed" -eq 0 ]]; then
  printf 'No matching LaunchAgent templates found.\n' >&2
  exit 1
fi

printf 'Done. Logs: /tmp/asset-allocation-*.log; 触发一次可用 launchctl kickstart -k gui/%s/%s\n' "$UID" "${FILTER:+com.asset-allocation.$FILTER}"
