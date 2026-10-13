#!/usr/bin/env bash
# Gece yedeği: self-hosted Supabase Postgres (pg_dump -Fc, yetkiler dahil) + Storage dosyaları.
# Hedef /root/backups/gece (14 gün). Storage Box açılınca BACKUP_REMOTE ile dışarı kopyalanır
# (ör. BACKUP_REMOTE=u123456@u123456.your-storagebox.de:emlaksoft, ssh anahtarıyla).
# Şifreleme: BACKUP_AGE_RECIPIENT (age açık anahtarı, `age1...`) tanımlıysa yedekler yalnız
# `.age` olarak yazılır (düz dosya bırakılmaz). Çözme: `age -d -i <gizli-anahtar> db-....dump.age > db.dump`.
# Gizli anahtar bu sunucuda TUTULMAZ. Tanımsızsa ya da age kurulu değilse düz yedek + uyarı.
# Kurulum: /etc/cron.d/emlaksoft-backup (scripts/sunucu/install-cron.sh).
# Panel durumu: başarılı yedekten sonra platform_settings 'ops.backup.last' (JSON) ve cron_heartbeats 'yedek-gece'
# yazılır (Sistem > Yedek kartı; uygulama konteyneri yedek dosyalarına erişemez). Bu yazım BAŞARISIZ olsa da yedek
# etkilenmez: hata yalnız günlüğe düşer. Hatayla biten koşuda nabız 'error' yazılır (en iyi çaba).
# Kuru çalıştırma: DRY_RUN=1 → yedek almaz, DB'ye dokunmaz; yazılacak nabız/JSON'u ekrana basar.
set -euo pipefail
umask 077
SVC=moqbebljyeyprktd19zb1ihn
DB=supabase-db-$SVC
DIR=/root/backups/gece
KEEP_DAYS=14
TS=$(date -u +%Y%m%d-%H%M)
log() { echo "$(date -u +%FT%TZ) $*"; }

# Durum yazımı: değerler psql değişkeni (:'ad') olarak geçer → tırnaklama psql'de, SQL enjeksiyonu yok.
# Boş JSON = yalnız nabız. Hata yedeği durdurmaz (yalnız günlük).
STATUS_SQL=$(cat <<'SQL'
\set ON_ERROR_STOP on
begin;
insert into public.cron_heartbeats (job, last_run_at, last_status, last_detail)
values ('yedek-gece', now(), :'hbs', :'hbd')
on conflict (job) do update
  set last_run_at = excluded.last_run_at, last_status = excluded.last_status, last_detail = excluded.last_detail;
\if :{?val}
insert into public.platform_settings (key, value, updated_at)
values ('ops.backup.last', :'val', now())
on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;
\endif
commit;
SQL
)
write_status() {
  local json="$1" hb_status="$2" hb_detail="$3"
  if [ "${DRY_RUN:-0}" = 1 ]; then
    echo "[kuru] nabız yedek-gece: $hb_status / $hb_detail"
    echo "[kuru] ops.backup.last: ${json:-<yazılmaz>}"
    return 0
  fi
  local args=(-v "hbs=$hb_status" -v "hbd=$hb_detail")
  if [ -n "$json" ]; then args+=(-v "val=$json"); fi
  if ! printf '%s\n' "$STATUS_SQL" | docker exec -i "$DB" psql -X -q -U supabase_admin -d postgres "${args[@]}" >/dev/null 2>&1; then
    log "UYARI: yedek durumu veritabanına yazılamadı (yedek etkilenmedi)"
  fi
}

# JSON sayı alanı: rakam değilse null.
jnum() { case "$1" in '' | *[!0-9]*) echo null ;; *) echo "$1" ;; esac; }

backup_json() { # at dbFile size tables encrypted remote objs files
  printf '{"at":"%s","dbFile":"%s","sizeBytes":%s,"tables":%s,"encrypted":%s,"remote":%s,"storageObjects":%s,"archiveFiles":%s,"retentionDays":%s}' \
    "$1" "$2" "$(jnum "$3")" "$(jnum "$4")" "$5" "$6" "$(jnum "$7")" "$(jnum "$8")" "$KEEP_DAYS"
}

if [ "${DRY_RUN:-0}" = 1 ]; then
  log "kuru çalıştırma: yedek alınmaz"
  write_status "$(backup_json "$(date -u +%FT%TZ)" "db-$TS.dump" 123 456 false false "?" 7)" ok "kuru çalıştırma"
  exit 0
fi

mkdir -p "$DIR"; chmod 700 "$DIR"

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
DONE=0
# Yarım kalan/düz ara dosyalar hiçbir çıkış yolunda bırakılmaz; hatayla çıkışta nabız 'error' yazılır.
cleanup() {
  local rc=$?
  if [ "$DONE" != 1 ] && [ "$rc" != 0 ]; then
    write_status "" error "yedek başarısız (çıkış $rc)" || true
  fi
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

REMOTE=false
REMOTE_FAILED=0
if [ -n "${BACKUP_REMOTE:-}" ]; then
  if rsync -a -e "ssh -p 23 -o BatchMode=yes" "$DB_OUT" "$ST_OUT" "$BACKUP_REMOTE/"; then
    REMOTE=true
  else
    REMOTE_FAILED=1
    log "HATA: uzak kopya (BACKUP_REMOTE) başarısız — yerel yedek duruyor"
  fi
fi

find "$DIR" \( -name 'db-*.dump' -o -name 'db-*.dump.age' \) -mtime +$KEEP_DAYS -delete
find "$DIR" \( -name 'storage-*.tgz' -o -name 'storage-*.tgz.age' \) -mtime +$KEEP_DAYS -delete
log "yedek tamam: $(basename "$DB_OUT") ($(du -h "$DB_OUT" | cut -f1), $N tablo verisi), $(basename "$ST_OUT") ($FILES dosya)"

# Panel durumu (Sistem > Yedek).
ENC=false
if [ "$ENCRYPT" = 1 ]; then ENC=true; fi
SIZE=$(stat -c %s "$DB_OUT" 2>/dev/null || echo "")
JSON=$(backup_json "$(date -u +%FT%TZ)" "$(basename "$DB_OUT")" "$SIZE" "$N" "$ENC" "$REMOTE" "$OBJS" "$FILES")
DONE=1
if [ "$REMOTE_FAILED" = 1 ]; then
  write_status "$JSON" error "yedek alındı, uzak kopya başarısız"
  exit 1
fi
write_status "$JSON" ok "$(basename "$DB_OUT"), $N tablo verisi"
