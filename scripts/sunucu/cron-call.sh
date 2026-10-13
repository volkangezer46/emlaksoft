#!/usr/bin/env bash
# Tek bir cron rotasını Vercel Cron gibi çağırır: GET + Authorization: Bearer $CRON_SECRET.
# Çakışma yok (rota başına flock), 300 sn üst sınır. Çağrı uygulama konteynerinin içinden yapılır.
set -uo pipefail
ROUTE=$1
SECRET=$(grep -E '^CRON_SECRET=' /root/emlaksoft/.env.production | cut -d= -f2-)
LOCK=/run/lock/emlaksoft-cron-$(basename "$ROUTE").lock
exec 9>"$LOCK"; flock -n 9 || { echo "$(date -u +%FT%TZ) $ROUTE atlandı (önceki sürüyor)"; exit 0; }
CODE=$(docker exec emlaksoft-app curl -s -o /dev/null -w '%{http_code}' --max-time 300 \
  -H "Authorization: Bearer $SECRET" -H "User-Agent: emlaksoft-cron/1.0" "http://127.0.0.1:3000$ROUTE")
echo "$(date -u +%FT%TZ) $ROUTE $CODE"
