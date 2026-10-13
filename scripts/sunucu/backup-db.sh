#!/usr/bin/env bash
# Gece yedeği: self-hosted Supabase Postgres (pg_dump -Fc, yetkiler dahil) + Storage dosyaları.
# Hedef /root/backups/gece (14 gün). Storage Box açılınca BACKUP_REMOTE ile dışarı kopyalanır
# (ör. BACKUP_REMOTE=u123456@u123456.your-storagebox.de:emlaksoft, ssh anahtarıyla).
# Kurulum: /etc/cron.d/emlaksoft-backup (scripts/sunucu/install-cron.sh).
set -euo pipefail
SVC=moqbebljyeyprktd19zb1ihn
DB=supabase-db-$SVC
DIR=/root/backups/gece
KEEP_DAYS=14
TS=$(date -u +%Y%m%d-%H%M)
mkdir -p "$DIR"; chmod 700 "$DIR"

docker exec "$DB" pg_dump -U supabase_admin -d postgres -Fc > "$DIR/db-$TS.dump.part"
mv "$DIR/db-$TS.dump.part" "$DIR/db-$TS.dump"
# Bütünlük: arşiv okunabilir ve tablo verisi içeriyor mu
N=$(docker exec -i "$DB" pg_restore -l < "$DIR/db-$TS.dump" | grep -c 'TABLE DATA')
[ "$N" -gt 200 ] || { echo "$(date -u +%FT%TZ) HATA: yedekte yalnız $N TABLE DATA"; exit 1; }

tar -C /data/coolify/services/$SVC/volumes -czf "$DIR/storage-$TS.tgz" storage

if [ -n "${BACKUP_REMOTE:-}" ]; then
  rsync -a -e "ssh -p 23 -o BatchMode=yes" "$DIR/db-$TS.dump" "$DIR/storage-$TS.tgz" "$BACKUP_REMOTE/"
fi

find "$DIR" -name 'db-*.dump' -mtime +$KEEP_DAYS -delete
find "$DIR" -name 'storage-*.tgz' -mtime +$KEEP_DAYS -delete
echo "$(date -u +%FT%TZ) yedek tamam: db-$TS.dump ($(du -h "$DIR/db-$TS.dump" | cut -f1), $N tablo verisi)"
