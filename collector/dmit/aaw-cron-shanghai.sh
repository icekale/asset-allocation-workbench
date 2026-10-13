#!/bin/bash
# Run a command only when Asia/Shanghai local time matches HHMM.
# Debian Vixie cron (cron 3.0pl1) ignores CRON_TZ for *scheduling* (it only exports
# the var to the job). System TZ is America/Los_Angeles, so wall-clock crontab
# entries would fire 15h early vs Shanghai. Use: * * * * * aaw-cron-shanghai.sh HHMM DOW cmd…
# DOW: * | 1-5 (weekdays) | 16,26 (day-of-month list) | mon-style cron DOW/DOM subset.
set -euo pipefail
export TZ=Asia/Shanghai
HHMM="${1:?HHMM}"; shift
WHEN="${1:?when}"; shift
now_hm=$(date +%H%M)
dom=$(date +%d)
dow=$(date +%u) # 1=Mon … 7=Sun
[[ "$now_hm" == "$HHMM" ]] || exit 0
case "$WHEN" in
  \*) ;;
  1-5) [[ "$dow" -ge 1 && "$dow" -le 5 ]] || exit 0 ;;
  16,26) [[ "$dom" == "16" || "$dom" == "26" ]] || exit 0 ;;
  *) echo "unsupported when=$WHEN" >&2; exit 2 ;;
esac
# flock so a long job cannot overlap the next minute
lock="/run/aaw-cron-${HHMM}-${WHEN//[^A-Za-z0-9]/_}.lock"
exec 9>"$lock"
flock -n 9 || exit 0
exec "$@"
