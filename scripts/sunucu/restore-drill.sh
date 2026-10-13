#!/usr/bin/env bash
# Geri yükleme tatbikatı (AD11): bir pg_dump arşivini GEÇİCİ, ağsız bir veritabanı konteynerine yükler ve kritik
# tabloların satır sayılarını kontrol eder. Canlı veritabanına YALNIZ sonuç yazılır (restore_drills satırı,
# platform_settings 'ops.restore_drill.last', cron_heartbeats 'geri-yukleme-tatbikati'); başarısızsa aktif süper
# adminlere platform bildirimi düşer (Sistem > Yedek kartı da kırmızı gösterir).
#
# Kullanım:
#   restore-drill.sh <db-....dump | db-....dump.age> [sayim-oncesi] [sayim-sonrasi]
#   - sayım dosyaları ("tablo|satır" satırları) backup-db.sh'nin dump'tan hemen önce/sonra aldığı canlı sayımlardır;
#     geri yüklenen sayı bu aralıkta olmalıdır. Verilmezse yalnız "tablo okunabilir ve tenants boş değil" denetlenir.
#   - .age dosyası için gizli anahtar AGE_IDENTITY_FILE ile verilir (sunucuda kalıcı TUTULMAZ; elle tatbikatta
#     geçici olarak). Gece akışında backup-db.sh tatbikatı şifrelemeden ÖNCE düz dump üzerinde çalıştırır.
#   - DRY_RUN=1: konteyner açmaz, DB'ye yazmaz; yapılacakları basar.
# Elle çalıştırma: bash scripts/sunucu/restore-drill.sh /root/backups/gece/db-YYYYMMDD-HHMM.dump
set -euo pipefail
umask 077
SVC=moqbebljyeyprktd19zb1ihn
DB=supabase-db-$SVC
WORK=/root/backups/tatbikat
log() { echo "$(date -u +%FT%TZ) [tatbikat] $*"; }

FILE=${1:-}
BEFORE=${2:-}
AFTER=${3:-}
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "kullanım: $0 <dump dosyası> [sayım-öncesi] [sayım-sonrası]" >&2
  exit 2
fi

# Satır sayısı denetlenen tablolar (şema.tablo). backup-db.sh aynı listeyi DRILL_TABLES ile kullanır.
DRILL_TABLES=${DRILL_TABLES:-"public.tenants public.profiles public.properties public.customers public.platform_staff public.platform_audit_logs public.audit_logs public.invoices auth.users storage.objects"}

STARTED_AT=$(date -u +%FT%TZ)
START=$(date +%s)
NAME="emlaksoft-drill-$(date -u +%Y%m%d%H%M%S)"
TMP_DUMP=""
ERRLOG=""
RESULT_STATUS=error
DETAIL="tamamlanmadı"
MISMATCH_JSON="[]"
RESTORE_ERRORS=""
CHECKED=0

# JSON metin alanı: tırnak/ters bölü/denetim karakteri atılır, 280 karakterle sınırlanır.
jstr() { printf '%s' "$1" | tr -d '"\\' | tr -d '\000-\037' | cut -c1-280; }

RESULT_SQL=$(cat <<'SQL'
\set ON_ERROR_STOP on
begin;
insert into public.cron_heartbeats (job, last_run_at, last_status, last_detail)
values ('geri-yukleme-tatbikati', now(), :'hbs', :'hbd')
on conflict (job) do update
  set last_run_at = excluded.last_run_at, last_status = excluded.last_status, last_detail = excluded.last_detail;
insert into public.platform_settings (key, value, updated_at)
values ('ops.restore_drill.last', :'val', now())
on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;
commit;
SQL
)
TABLE_SQL=$(cat <<'SQL'
\set ON_ERROR_STOP on
insert into public.restore_drills (started_at, status, backup_file, duration_sec, tables_checked, restore_errors, mismatches, detail)
values (:'started'::timestamptz, :'st', :'file', :'dur'::int, :'chk'::int, nullif(:'rerr', '')::int, :'mm'::jsonb, :'det');
SQL
)
NOTIFY_SQL=$(cat <<'SQL'
\set ON_ERROR_STOP on
insert into public.platform_notifications (staff_id, title, body, href, kind, meta)
select ps.id, 'Geri yükleme tatbikatı başarısız', :'det', '/admin/sistem#yedek', 'danger',
       jsonb_build_object('source', 'restore-drill', 'file', :'file')
from public.platform_staff ps
where ps.is_active = true and ps.role = 'super_admin';
SQL
)

record_result() {
  local dur=$(( $(date +%s) - START ))
  local file; file=$(basename "$FILE")
  local det; det=$(jstr "$DETAIL")
  local json
  json=$(printf '{"at":"%s","status":"%s","durationSec":%s,"backupFile":"%s","tablesChecked":%s,"restoreErrors":%s,"mismatches":%s,"detail":"%s"}' \
    "$(date -u +%FT%TZ)" "$RESULT_STATUS" "$dur" "$(jstr "$file")" "$CHECKED" "${RESTORE_ERRORS:-null}" "$MISMATCH_JSON" "$det")
  if [ "${DRY_RUN:-0}" = 1 ]; then
    echo "[kuru] ops.restore_drill.last: $json"
    return 0
  fi
  local hb=ok; [ "$RESULT_STATUS" = ok ] || hb=error
  printf '%s\n' "$RESULT_SQL" | docker exec -i "$DB" psql -X -q -U supabase_admin -d postgres \
    -v "hbs=$hb" -v "hbd=$det" -v "val=$json" >/dev/null 2>&1 || log "UYARI: tatbikat durumu yazılamadı"
  # restore_drills tablosu migration öncesinde yoksa yalnız günlüğe düşer.
  printf '%s\n' "$TABLE_SQL" | docker exec -i "$DB" psql -X -q -U supabase_admin -d postgres \
    -v "started=$STARTED_AT" -v "st=$RESULT_STATUS" -v "file=$file" -v "dur=$dur" -v "chk=$CHECKED" \
    -v "rerr=${RESTORE_ERRORS:-}" -v "mm=$MISMATCH_JSON" -v "det=$det" >/dev/null 2>&1 || log "UYARI: restore_drills satırı yazılamadı"
  if [ "$RESULT_STATUS" != ok ]; then
    printf '%s\n' "$NOTIFY_SQL" | docker exec -i "$DB" psql -X -q -U supabase_admin -d postgres \
      -v "det=$det" -v "file=$file" >/dev/null 2>&1 || log "UYARI: başarısız tatbikat bildirimi yazılamadı"
  fi
}

cleanup() {
  local rc=$?
  if [ "${DRY_RUN:-0}" != 1 ]; then
    docker rm -f "$NAME" >/dev/null 2>&1 || true
  fi
  [ -n "$TMP_DUMP" ] && rm -f "$TMP_DUMP"
  [ -n "$ERRLOG" ] && rm -f "$ERRLOG"
  if [ "$RESULT_STATUS" != ok ] && [ "$DETAIL" = "tamamlanmadı" ]; then DETAIL="tatbikat yarıda kaldı (çıkış $rc)"; fi
  record_result || true
}
trap cleanup EXIT

if [ "${DRY_RUN:-0}" = 1 ]; then
  log "kuru çalıştırma: $(basename "$FILE") geçici konteynere yüklenecekti; tablolar: $DRILL_TABLES"
  RESULT_STATUS=ok
  DETAIL="kuru çalıştırma"
  exit 0
fi

mkdir -p "$WORK"; chmod 700 "$WORK"
SRC="$FILE"
case "$FILE" in
  *.age)
    if [ -z "${AGE_IDENTITY_FILE:-}" ] || [ ! -r "${AGE_IDENTITY_FILE:-}" ]; then
      DETAIL="şifreli yedek için AGE_IDENTITY_FILE (gizli anahtar) gerekli"
      exit 1
    fi
    TMP_DUMP="$WORK/$(basename "$FILE" .age)"
    age -d -i "$AGE_IDENTITY_FILE" -o "$TMP_DUMP" "$FILE"
    chmod 600 "$TMP_DUMP"
    SRC="$TMP_DUMP"
    ;;
esac

IMAGE=$(docker inspect -f '{{.Config.Image}}' "$DB")
# Ağsız, kaynak sınırlı, kendiliğinden silinmeyen (hata ayıklama için cleanup siler) geçici konteyner.
docker run -d --name "$NAME" --network none --memory 2g --cpus 1 \
  -e POSTGRES_PASSWORD="$(openssl rand -hex 16)" "$IMAGE" >/dev/null

# Hazır: ilk kurulum betikleri bitti ("init process complete") ve sunucu bağlantı kabul ediyor.
READY=0
for _ in $(seq 1 150); do
  if docker logs "$NAME" 2>&1 | grep -q "init process complete" \
    && docker exec "$NAME" pg_isready -U supabase_admin -d postgres >/dev/null 2>&1; then
    READY=1; break
  fi
  sleep 2
done
if [ "$READY" != 1 ]; then
  DETAIL="geçici veritabanı 300 sn içinde hazır olmadı"
  exit 1
fi

ERRLOG="$WORK/$NAME.err"
# --clean --if-exists: imajın hazır şemaları (auth/storage) yedektekiyle değiştirilir; beklenen nesne hataları
# sayılır ama tatbikatı düşürmez — karar satır sayılarıyla verilir.
docker exec -i "$NAME" pg_restore -U supabase_admin -d postgres --clean --if-exists --no-owner --no-privileges \
  < "$SRC" 2> "$ERRLOG" || true
RESTORE_ERRORS=$(grep -oE 'errors ignored on restore: [0-9]+' "$ERRLOG" | grep -oE '[0-9]+$' | tail -1 || true)
RESTORE_ERRORS=${RESTORE_ERRORS:-0}

count_of() { # dosya tablo → sayı (yoksa boş)
  [ -n "$1" ] && [ -f "$1" ] && awk -F'|' -v t="$2" '$1==t {print $2}' "$1" | head -1
}

MISMATCHES=()
for t in $DRILL_TABLES; do
  got=$(docker exec "$NAME" psql -X -At -U supabase_admin -d postgres -c "select count(*) from $t" 2>/dev/null || echo "")
  CHECKED=$((CHECKED + 1))
  if ! [[ "$got" =~ ^[0-9]+$ ]]; then
    MISMATCHES+=("$t: okunamadı")
    continue
  fi
  b=$(count_of "$BEFORE" "$t" || true)
  a=$(count_of "$AFTER" "$t" || true)
  if [[ "$b" =~ ^[0-9]+$ ]] && [[ "$a" =~ ^[0-9]+$ ]]; then
    lo=$b; hi=$a; if [ "$lo" -gt "$hi" ]; then lo=$a; hi=$b; fi
    if [ "$got" -lt "$lo" ] || [ "$got" -gt "$hi" ]; then
      MISMATCHES+=("$t: geri yüklenen $got, canlı $lo-$hi")
    fi
  elif [ "$t" = "public.tenants" ] && [ "$got" -eq 0 ]; then
    MISMATCHES+=("$t: boş")
  fi
done

if [ "${#MISMATCHES[@]}" -eq 0 ]; then
  RESULT_STATUS=ok
  DETAIL="$CHECKED tablo doğrulandı, $RESTORE_ERRORS beklenen nesne uyarısı"
  MISMATCH_JSON="[]"
else
  RESULT_STATUS=error
  DETAIL="${#MISMATCHES[@]} tabloda satır sayısı tutmadı: ${MISMATCHES[0]}"
  MISMATCH_JSON="["
  for m in "${MISMATCHES[@]}"; do MISMATCH_JSON+="\"$(jstr "$m")\","; done
  MISMATCH_JSON="${MISMATCH_JSON%,}]"
fi
log "$RESULT_STATUS: $DETAIL ($(( $(date +%s) - START )) sn)"
[ "$RESULT_STATUS" = ok ]
