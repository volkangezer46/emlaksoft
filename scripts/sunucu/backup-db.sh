#!/usr/bin/env bash
# Gece yedeği: self-hosted Supabase Postgres (pg_dump -Fc, yetkiler dahil) + Storage dosyaları.
# Hedef /root/backups/gece (14 gün). Storage Box açılınca BACKUP_REMOTE ile dışarı kopyalanır
# (ör. BACKUP_REMOTE=u123456@u123456.your-storagebox.de:emlaksoft, ssh anahtarıyla).
# Şifreleme: BACKUP_AGE_RECIPIENT (age açık anahtarı, `age1...`) tanımlıysa yedekler yalnız
# `.age` olarak yazılır (düz dosya bırakılmaz). Çözme: `age -d -i <gizli-anahtar> db-....dump.age > db.dump`.
# Gizli anahtar bu sunucuda TUTULMAZ. Tanımsızsa ya da age kurulu değilse düz yedek + uyarı.
# Kurulum: /etc/cron.d/emlaksoft-backup (scripts/sunucu/install-cron.sh).
set -euo pipefail
umask 077
SVC=moqbebljyeyprktd19zb1ihn
DB=supabase-db-$SVC
DIR=/root/backups/gece
KEEP_DAYS=14
TS=$(date -u +%Y%m%d-%H%M)
mkdir -p "$DIR"; chmod 700 "$DIR"
log() { echo "$(date -u +%FT%TZ) $*"; }

ENCRYPT=0
if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
  if command -v age >/dev/null 2>&1; then
    ENCRYPT=1
  else
    log "UYARI: BACKUP_AGE_RECIPIENT tanımlı ama 'age' kurulu değil (apt install age) — yedek ŞİFRESİZ yazılıyor"
  fi
else
  log "UYARI: BACKUP_AGE_RECIPIENT tanımsız — yedek şifresiz yazılıyor"
fi

PLAIN="$DIR/db-$TS.dump"
IDX="$DIR/.storage-$TS.idx"
# Yarım kalan/düz ara dosyalar hiçbir çıkış yolunda bırakılmaz.
cleanup() {
  rm -f "$PLAIN.part" "$IDX" "$DIR/storage-$TS.tgz.part" "$DIR/storage-$TS.tgz.age.part" "$PLAIN.age.part"
  if [ "$ENCRYPT" = 1 ]; then rm -f "$PLAIN"; fi
}
trap cleanup EXIT

docker exec "$DB" pg_dump -U supabase_admin -d postgres -Fc > "$PLAIN.part"
mv "$PLAIN.part" "$PLAIN"
# Bütünlük: arşiv okunabilir ve tablo verisi içeriyor mu (şifrelemeden önce, düz kopya üzerinde)
N=$(docker exec -i "$DB" pg_restore -l < "$PLAIN" | grep -c 'TABLE DATA')
[ "$N" -gt 200 ] || { log "HATA: yedekte yalnız $N TABLE DATA"; exit 1; }

if [ "$ENCRYPT" = 1 ]; then
  age -r "$BACKUP_AGE_RECIPIENT" -o "$PLAIN.age.part" "$PLAIN"
  mv "$PLAIN.age.part" "$PLAIN.age"
  rm -f "$PLAIN"
  DB_OUT="$PLAIN.age"
  ST_OUT="$DIR/storage-$TS.tgz.age"
  tar -C /data/coolify/services/$SVC/volumes -czvf - --index-file="$IDX" storage \
    | age -r "$BACKUP_AGE_RECIPIENT" -o "$ST_OUT.part"
else
  DB_OUT="$PLAIN"
  ST_OUT="$DIR/storage-$TS.tgz"
  tar -C /data/coolify/services/$SVC/volumes -czvf "$ST_OUT.part" --index-file="$IDX" storage
fi
mv "$ST_OUT.part" "$ST_OUT"
chmod 600 "$DB_OUT" "$ST_OUT"

# Storage denetimi: storage.objects satır sayısı ile arşivdeki dosya sayısı (dizinler hariç).
FILES=$(grep -cv '/$' "$IDX" || true)
OBJS=$(docker exec "$DB" psql -U supabase_admin -d postgres -Atc "select count(*) from storage.objects" 2>/dev/null || echo "?")
if [ "$OBJS" != "$FILES" ]; then
  log "UYARI: storage.objects=$OBJS ama arşivde $FILES dosya — storage yedeği eksik/fazla olabilir"
fi

if [ -n "${BACKUP_REMOTE:-}" ]; then
  rsync -a -e "ssh -p 23 -o BatchMode=yes" "$DB_OUT" "$ST_OUT" "$BACKUP_REMOTE/"
fi

find "$DIR" \( -name 'db-*.dump' -o -name 'db-*.dump.age' \) -mtime +$KEEP_DAYS -delete
find "$DIR" \( -name 'storage-*.tgz' -o -name 'storage-*.tgz.age' \) -mtime +$KEEP_DAYS -delete
log "yedek tamam: $(basename "$DB_OUT") ($(du -h "$DB_OUT" | cut -f1), $N tablo verisi), $(basename "$ST_OUT") ($FILES dosya)"
