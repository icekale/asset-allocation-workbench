#!/bin/bash
# Install AAW crontab entries gated by Asia/Shanghai wall clock.
# Idempotent. Keeps non-AAW lines (e.g. g6_probe) unchanged.
set -euo pipefail
install -m 755 /root/aaw/collector/dmit/aaw-cron-shanghai.sh /root/bin/aaw-cron-shanghai.sh
install -m 755 /root/aaw/collector/dmit/aaw-portal-run.sh /root/bin/aaw-portal-run.sh
install -m 755 /root/aaw/collector/dmit/aaw-portal-rebuild.sh /root/bin/aaw-portal-rebuild.sh
install -m 755 /root/aaw/collector/dmit/aaw-backup.sh /root/bin/aaw-backup.sh
install -m 755 /root/aaw/collector/dmit/aaw-collector.sh /root/bin/aaw-collector.sh
install -m 755 /root/aaw/collector/dmit/aaw-index-refresh.sh /root/bin/aaw-index-refresh.sh
tmpdir=$(mktemp)
crontab -l 2>/dev/null | grep -vE 'aaw-collector|aaw-index-refresh|aaw-backup|aaw-cron-shanghai|CRON_TZ=Asia/Shanghai' >"$tmpdir" || true
cat >>"$tmpdir" <<'EOF'
# AAW jobs: Debian Vixie cron ignores CRON_TZ for scheduling (system TZ=America/Los_Angeles).
# Gate on Asia/Shanghai via aaw-cron-shanghai.sh (HHMM, when, command…).
* * * * * /root/bin/aaw-cron-shanghai.sh 0930 1-5 AAW_MODE=audit-light /root/bin/aaw-collector.sh
* * * * * /root/bin/aaw-cron-shanghai.sh 0940 16,26 AAW_MODE=apply /root/bin/aaw-collector.sh
* * * * * /root/bin/aaw-cron-shanghai.sh 1510 1-5 /root/bin/aaw-index-refresh.sh
* * * * * /root/bin/aaw-cron-shanghai.sh 0317 '*' /root/bin/aaw-backup.sh >> /var/log/aaw/backup.log 2>&1
EOF
# Fix the quoted star for backup when - the heredoc with '*' is wrong for when=*
# Rewrite backup line properly
grep -v "aaw-backup" "$tmpdir" >"$tmpdir.2" || true
echo "* * * * * /root/bin/aaw-cron-shanghai.sh 0317 '*' /root/bin/aaw-backup.sh >> /var/log/aaw/backup.log 2>&1" >>"$tmpdir.2"
# Actually the when arg for daily should be *
# Use a different approach - pass * without shell glob
cat >"$tmpdir" <<'EOF'
EOF
crontab -l 2>/dev/null | grep -vE 'aaw-collector|aaw-index-refresh|aaw-backup|aaw-cron-shanghai|CRON_TZ=Asia/Shanghai' >"$tmpdir" || true
printf '%s\n' \
  '# AAW: Vixie cron schedules in system TZ; shanghai helper gates on Asia/Shanghai HHMM.' \
  '* * * * * /root/bin/aaw-cron-shanghai.sh 0930 1-5 AAW_MODE=audit-light /root/bin/aaw-collector.sh' \
  '* * * * * /root/bin/aaw-cron-shanghai.sh 0940 16,26 AAW_MODE=apply /root/bin/aaw-collector.sh' \
  '* * * * * /root/bin/aaw-cron-shanghai.sh 1510 1-5 /root/bin/aaw-index-refresh.sh' \
  "* * * * * /root/bin/aaw-cron-shanghai.sh 0317 '*' /root/bin/aaw-backup.sh >> /var/log/aaw/backup.log 2>&1" \
  >>"$tmpdir"
crontab "$tmpdir"
rm -f "$tmpdir" "$tmpdir.2"
echo "installed crontab:"; crontab -l
