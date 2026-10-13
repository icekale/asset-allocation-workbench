#!/bin/bash
# Rebuild prod portal after a rating publish / deploy, then restart services.
# Never deletes /var/lib/aaw/wrangler-state (D1 persistence outside dist/).
set -uo pipefail
exec >>/var/log/aaw/portal-rebuild.log 2>&1
echo "=== rebuild at $(date -Is) ==="
PERSIST="${AAW_WRANGLER_PERSIST:-/var/lib/aaw/wrangler-state}"
if [[ -e "$PERSIST" ]]; then
  echo "preserving D1 persist-to=$PERSIST"
else
  echo "WARN: persist dir missing ($PERSIST); portal will start empty until index refresh"
fi
# Guard: refuse to rm -rf persist path even if a future build script tries
cd /root/aaw && npm run build && systemctl restart aaw-portal.service aaw-portal-sock.service && systemctl try-restart aaw-portal-proxy.service aaw-portal-proxy-docker0.service
echo "=== rebuild done exit=$? persist_exists=$([[ -d $PERSIST ]] && echo yes || echo no) ==="
