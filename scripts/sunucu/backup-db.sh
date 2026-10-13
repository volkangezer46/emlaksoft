#!/usr/bin/env bash
# Gece yedeği: self-hosted Supabase Postgres (pg_dump -Fc, yetkiler dahil) + Storage dosyaları.
# Hedef /root/backups/gece (14 gün, tüm dosyalar 600, dizin 700).
# AYARLAR (AD11): yönetim panelinden girilir (Sistem Ayarları Merkezi > Sağlık ve izleme; platform_settings):
#   ops.backup.age_recipient  age açık anahtarı (age1…)          | ortam: BACKUP_AGE_RECIPIENT (öncelikli)
#   ops.backup.remote_kind    off | ssh (Storage Box) | rclone (S3 uyumlu)
#   ops.backup.remote_target  ssh: kullanici@host:klasor · rclone: uzak-ad:yol | ortam: BACKUP_REMOTE (ssh, öncelikli)
#   ops.backup.remote_port    ssh portu (Storage Box 23)
#   ops.restore_drill.weekday 0-6 (TSİ; 0=Pazar) | off — haftalık geri yükleme tatbikatı günü
# Gizli bilgiler panele GİRMEZ: ssh anahtarı (/root/.ssh) ve rclone yapılandırması (rclone config) yalnız sunucuda.
# Şifreleme: alıcı anahtarı varsa yedekler yalnız `.age` olarak yazılır (düz dosya bırakılmaz).
# Çözme: `age -d -i <gizli-anahtar> db-....dump.age > db.dump`. Gizli anahtar bu sunucuda TUTULMAZ.
# Anahtar yoksa ya da age kurulu değilse düz yedek + uyarı (kart "Şifresiz" gösterir).
# Uzak kopya yüklendikten sonra hedefte LİSTELENEREK doğrulanır; doğrulanmayan kopya "uzakta: hayır" yazılır.
# Tatbikat günü: dump alınır alınmaz (şifrelemeden önce, düz kopya üzerinde) scripts/sunucu/restore-drill.sh
# geçici konteynere yükler ve satır sayılarını dump öncesi/sonrası canlı sayımlarla karşılaştırır. Tatbikat
# başarısızlığı yedeği düşürmez; sonucu ayrı nabız + bildirim olarak yazılır.
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
STARTED_AT=$(date -u +%FT%TZ)
HERE=$(cd "$(dirname "$0")" && pwd)
log() { echo "$(date -u +%FT%TZ) $*"; }
DRILL_TABLES="public.tenants public.profiles public.properties public.customers public.platform_staff public.platform_audit_logs public.audit_logs public.invoices auth.users storage.objects"
export DRILL_TABLES

# Panel ayarları (salt-okunur sorgu; okunamazsa boş → ortam değişkenleri/varsayılanlar).
setting() { printf '%s\n' "$SETTINGS" | awk -F'|' -v k="$1" '$1==k {sub(/^[^|]*\|/, ""); print; exit}'; }
SETTINGS=""
if [ "${DRY_RUN:-0}" != 1 ]; then
  SETTINGS=$(docker exec "$DB" psql -X -At -U supabase_admin -d postgres -c \
    "select key, value from public.platform_settings where key in ('ops.backup.age_recipient','ops.backup.remote_kind','ops.backup.remote_target','ops.backup.remote_port','ops.restore_drill.weekday')" \
    2>/dev/null || true)
fi
AGE_RECIPIENT=${BACKUP_AGE_RECIPIENT:-$(setting ops.backup.age_recipient)}
REMOTE_KIND=$(setting ops.backup.remote_kind); REMOTE_KIND=${REMOTE_KIND:-off}
REMOTE_TARGET=$(setting ops.backup.remote_target)
REMOTE_PORT=$(setting ops.backup.remote_port); REMOTE_PORT=${REMOTE_PORT:-23}
DRILL_DAY=$(setting ops.restore_drill.weekday); DRILL_DAY=${DRILL_DAY:-0}
if [ -n "${BACKUP_REMOTE:-}" ]; then REMOTE_KIND=ssh; REMOTE_TARGET=$BACKUP_REMOTE; fi
# Biçim kuralları panel doğrulamasıyla aynı: değer komut satırına seçenek olarak sızamaz.
if [ -n "$AGE_RECIPIENT" ] && ! [[ "$AGE_RECIPIENT" =~ ^age1[02-9ac-hj-np-z]{58}$ ]]; then
  log "UYARI: age açık anahtarı geçersiz biçimde — yok sayıldı"; AGE_RECIPIENT=""
fi
case "$REMOTE_KIND" in
  ssh) [[ "$REMOTE_TARGET" =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[A-Za-z0-9._/-]*$ ]] || { [ -n "$REMOTE_TARGET" ] && log "UYARI: ssh hedefi geçersiz — uzak kopya kapalı"; REMOTE_KIND=off; } ;;
  rclone) [[ "$REMOTE_TARGET" =~ ^[A-Za-z0-9_-]+:[A-Za-z0-9._/-]*$ ]] || { log "UYARI: rclone hedefi geçersiz — uzak kopya kapalı"; REMOTE_KIND=off; } ;;
  *) REMOTE_KIND=off ;;
esac
[[ "$REMOTE_PORT" =~ ^[0-9]{1,5}$ ]] || REMOTE_PORT=23

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
# backup_runs satırı (AD11): tablo yoksa (migration öncesi) yalnız günlüğe düşer.
RUN_SQL=$(cat <<'SQL'
\set ON_ERROR_STOP on
insert into public.backup_runs (started_at, status, db_file, storage_file, size_bytes, storage_bytes, tables, encrypted, remote, remote_kind, storage_objects, archive_files, detail)
values (:'started'::timestamptz, :'st', nullif(:'dbf', ''), nullif(:'stf', ''), nullif(:'sz', '')::bigint, nullif(:'ssz', '')::bigint,
        nullif(:'tb', '')::int, :'enc'::boolean, :'rem'::boolean, :'rk', nullif(:'objs', '')::int, nullif(:'files', '')::int, :'det');
SQL
)
write_run() { # status dbFile stFile size stSize tables enc remote objs files detail
  if [ "${DRY_RUN:-0}" = 1 ]; then echo "[kuru] backup_runs: $*"; return 0; fi
  local n
  n() { case "$1" in '' | *[!0-9]*) echo "" ;; *) echo "$1" ;; esac; }
  printf '%s\n' "$RUN_SQL" | docker exec -i "$DB" psql -X -q -U supabase_admin -d postgres \
    -v "started=$STARTED_AT" -v "st=$1" -v "dbf=$2" -v "stf=$3" -v "sz=$(n "$4")" -v "ssz=$(n "$5")" -v "tb=$(n "$6")" \
    -v "enc=$7" -v "rem=$8" -v "rk=$REMOTE_KIND" -v "objs=$(n "$9")" -v "files=$(n "${10}")" -v "det=${11}" >/dev/null 2>&1 \
    || log "UYARI: backup_runs satırı yazılamadı (tablo yok olabilir)"
}
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
  log "kuru çalıştırma: yedek alınmaz (uzak kopya: $REMOTE_KIND, tatbikat günü: $DRILL_DAY)"
  write_status "$(backup_json "$(date -u +%FT%TZ)" "db-$TS.dump" 123 456 false false "?" 7)" ok "kuru çalıştırma"
  write_run ok "db-$TS.dump" "storage-$TS.tgz" 123 0 456 false false "" 7 "kuru çalıştırma"
  exit 0
fi

mkdir -p "$DIR"; chmod 700 "$DIR"
# Eski/düz yedekler dahil dizindeki tüm dosyalar yalnız root okur (600).
find "$DIR" -maxdepth 1 -type f ! -perm 600 -exec chmod 600 {} + 2>/dev/null || true

ENCRYPT=0
if [ -n "$AGE_RECIPIENT" ]; then
  if command -v age >/dev/null 2>&1; then
    ENCRYPT=1
  else
    log "UYARI: age açık anahtarı tanımlı ama 'age' kurulu değil (apt install age) — yedek ŞİFRESİZ yazılıyor"
  fi
else
  log "UYARI: age açık anahtarı tanımsız (panel: ops.backup.age_recipient) — yedek şifresiz yazılıyor"
fi

PLAIN="$DIR/db-$TS.dump"
IDX="$DIR/.storage-$TS.idx"
DONE=0
COUNTS_BEFORE="$DIR/.counts-$TS.before"
COUNTS_AFTER="$DIR/.counts-$TS.after"
COUNT_SQL=""
for t in $DRILL_TABLES; do COUNT_SQL+="${COUNT_SQL:+ union all }select '$t', count(*) from $t"; done
TODAY_TR=$(TZ=Europe/Istanbul date +%w)
DRILL=0
if [ "$DRILL_DAY" = "$TODAY_TR" ] || [ "${FORCE_DRILL:-0}" = 1 ]; then DRILL=1; fi
# Yarım kalan/düz ara dosyalar hiçbir çıkış yolunda bırakılmaz; hatayla çıkışta nabız 'error' yazılır.
cleanup() {
  local rc=$?
  if [ "$DONE" != 1 ] && [ "$rc" != 0 ]; then
    write_status "" error "yedek başarısız (çıkış $rc)" || true
    write_run error "" "" "" "" "" false false "" "" "yedek başarısız (çıkış $rc)" || true
  fi
  rm -f "$PLAIN.part" "$IDX" "$DIR/storage-$TS.tgz.part" "$DIR/storage-$TS.tgz.age.part" "$PLAIN.age.part" "$COUNTS_BEFORE" "$COUNTS_AFTER"
  if [ "$ENCRYPT" = 1 ]; then rm -f "$PLAIN"; fi
}
trap cleanup EXIT

if [ "$DRILL" = 1 ]; then
  docker exec "$DB" psql -X -At -U supabase_admin -d postgres -c "$COUNT_SQL" > "$COUNTS_BEFORE" 2>/dev/null || : > "$COUNTS_BEFORE"
fi
docker exec "$DB" pg_dump -U supabase_admin -d postgres -Fc > "$PLAIN.part"
mv "$PLAIN.part" "$PLAIN"
chmod 600 "$PLAIN"
if [ "$DRILL" = 1 ]; then
  docker exec "$DB" psql -X -At -U supabase_admin -d postgres -c "$COUNT_SQL" > "$COUNTS_AFTER" 2>/dev/null || : > "$COUNTS_AFTER"
fi
# Bütünlük: arşiv okunabilir ve tablo verisi içeriyor mu (şifrelemeden önce, düz kopya üzerinde)
N=$(docker exec -i "$DB" pg_restore -l < "$PLAIN" | grep -c 'TABLE DATA')
[ "$N" -gt 200 ] || { log "HATA: yedekte yalnız $N TABLE DATA"; exit 1; }

# Haftalık geri yükleme tatbikatı (düz dump üzerinde, şifrelemeden önce). Başarısızlık yedeği düşürmez.
if [ "$DRILL" = 1 ]; then
  if bash "$HERE/restore-drill.sh" "$PLAIN" "$COUNTS_BEFORE" "$COUNTS_AFTER"; then
    log "geri yükleme tatbikatı başarılı"
  else
    log "UYARI: geri yükleme tatbikatı BAŞARISIZ (ayrıntı: Sistem > Yedek, /var/log/emlaksoft-backup.log)"
  fi
fi

if [ "$ENCRYPT" = 1 ]; then
  age -r "$AGE_RECIPIENT" -o "$PLAIN.age.part" "$PLAIN"
  mv "$PLAIN.age.part" "$PLAIN.age"
  rm -f "$PLAIN"
  DB_OUT="$PLAIN.age"
  ST_OUT="$DIR/storage-$TS.tgz.age"
  tar -C /data/coolify/services/$SVC/volumes -czvf - --index-file="$IDX" storage \
    | age -r "$AGE_RECIPIENT" -o "$ST_OUT.part"
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
DB_BASE=$(basename "$DB_OUT")
ST_BASE=$(basename "$ST_OUT")
if [ "$REMOTE_KIND" = ssh ]; then
  SSH_CMD="ssh -p $REMOTE_PORT -o BatchMode=yes"
  # Yükle, sonra hedefte listeleyerek doğrula (yalnız rsync çıkış koduna güvenilmez).
  if rsync -a -e "$SSH_CMD" -- "$DB_OUT" "$ST_OUT" "$REMOTE_TARGET/" \
    && rsync --list-only -e "$SSH_CMD" -- "$REMOTE_TARGET/$DB_BASE" >/dev/null \
    && rsync --list-only -e "$SSH_CMD" -- "$REMOTE_TARGET/$ST_BASE" >/dev/null; then
    REMOTE=true
  else
    REMOTE_FAILED=1
    log "HATA: uzak kopya (Storage Box) başarısız ya da doğrulanamadı — yerel yedek duruyor"
  fi
elif [ "$REMOTE_KIND" = rclone ]; then
  if ! command -v rclone >/dev/null 2>&1; then
    REMOTE_FAILED=1
    log "HATA: uzak kopya türü rclone ama rclone kurulu değil (apt install rclone; rclone config ile S3 uzak adı tanımlayın)"
  elif rclone copy -- "$DB_OUT" "$REMOTE_TARGET" && rclone copy -- "$ST_OUT" "$REMOTE_TARGET" \
    && rclone lsf -- "$REMOTE_TARGET" | grep -qxF "$DB_BASE" && rclone lsf -- "$REMOTE_TARGET" | grep -qxF "$ST_BASE"; then
    REMOTE=true
  else
    REMOTE_FAILED=1
    log "HATA: uzak kopya (rclone) başarısız ya da doğrulanamadı — yerel yedek duruyor"
  fi
fi

find "$DIR" \( -name 'db-*.dump' -o -name 'db-*.dump.age' \) -mtime +$KEEP_DAYS -delete
find "$DIR" \( -name 'storage-*.tgz' -o -name 'storage-*.tgz.age' \) -mtime +$KEEP_DAYS -delete
log "yedek tamam: $(basename "$DB_OUT") ($(du -h "$DB_OUT" | cut -f1), $N tablo verisi), $(basename "$ST_OUT") ($FILES dosya)"

# Panel durumu (Sistem > Yedek).
ENC=false
if [ "$ENCRYPT" = 1 ]; then ENC=true; fi
SIZE=$(stat -c %s "$DB_OUT" 2>/dev/null || echo "")
ST_SIZE=$(stat -c %s "$ST_OUT" 2>/dev/null || echo "")
JSON=$(backup_json "$(date -u +%FT%TZ)" "$(basename "$DB_OUT")" "$SIZE" "$N" "$ENC" "$REMOTE" "$OBJS" "$FILES")
DONE=1
if [ "$REMOTE_FAILED" = 1 ]; then
  write_status "$JSON" error "yedek alındı, uzak kopya başarısız"
  write_run partial "$DB_BASE" "$ST_BASE" "$SIZE" "$ST_SIZE" "$N" "$ENC" false "$OBJS" "$FILES" "yedek alındı, uzak kopya başarısız"
  exit 1
fi
write_status "$JSON" ok "$(basename "$DB_OUT"), $N tablo verisi"
write_run ok "$DB_BASE" "$ST_BASE" "$SIZE" "$ST_SIZE" "$N" "$ENC" "$REMOTE" "$OBJS" "$FILES" "$N tablo verisi"
