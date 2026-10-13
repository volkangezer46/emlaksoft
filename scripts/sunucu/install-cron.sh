#!/usr/bin/env bash
# vercel.json "crons" listesini (tek kaynak, npm run check:cron ile doğrulanır) /etc/cron.d/emlaksoft'a çevirir.
# Sunucu saat dilimi UTC = Vercel Cron saat dilimi. vercel.json değişince yeniden çalıştır.
set -euo pipefail
cd "$(dirname "$0")/../.."
CALL="$(pwd)/scripts/sunucu/cron-call.sh"
{
  echo "# OTOMATİK ÜRETİLDİ: scripts/sunucu/install-cron.sh ($(date -u +%F)) — elle düzenleme"
  echo "SHELL=/bin/bash"
  echo "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  python3 -I -c "
import json
for c in json.load(open('vercel.json'))['crons']:
    print(f\"{c['schedule']} root $CALL {c['path']} >> /var/log/emlaksoft-cron.log 2>&1\")"
} > /etc/cron.d/emlaksoft
chmod 644 /etc/cron.d/emlaksoft
cat > /etc/logrotate.d/emlaksoft-cron <<'R'
/var/log/emlaksoft-cron.log /var/log/emlaksoft-backup.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
}
R
cat > /etc/cron.d/emlaksoft-backup <<B
# Gece yedeği (03:30 TSİ = 00:30 UTC)
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 0 * * * root $(pwd)/scripts/sunucu/backup-db.sh >> /var/log/emlaksoft-backup.log 2>&1
B
chmod 644 /etc/cron.d/emlaksoft-backup
echo "$(grep -c '/api/cron/' /etc/cron.d/emlaksoft) cron + gece yedeği kuruldu"
