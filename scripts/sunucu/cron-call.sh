#!/usr/bin/env bash
# Tek bir cron rotasını Vercel Cron gibi çağırır: GET + Authorization: Bearer $CRON_SECRET (başlık stdin'den; argv'de yok).
# Çakışma yok (rota başına flock), 300 sn üst sınır. Çağrı uygulama konteynerinin içinden yapılır.
#
# YENİDEN DENEME + NABIZ (KQ4): rota HİÇ ÇALIŞMADIYSA 30 sn sonra BİR kez daha denenir. "Hiç çalışmadı" =
#   - bağlantı kurulamadı / konteyner yok (kod 000, curl çıkışı 28 DEĞİL), ya da
#   - 502 / 503 / 504 (konteyner yeniden başlıyor, cron yapılandırılmamış, üst kaynak yanıt vermedi).
# YENİDEN DENENMEZ: zaman aşımı (curl 28 ya da ~300 sn; rota Next içinde hâlâ çalışıyor olabilir, ikinci çağrı aynı işi
# eşzamanlı başlatır — flock yalnız bu betiği kilitler) ve 500 dahil diğer kodlar (rota kısmi ilerlemeden sonra düşmüş
# olabilir; randevu-hatirlat, gorev-hatirlat, kira-tahakkuk, proje-vade, ef-kontor-* gibi idempotent olmayan işlerde
# ikinci deneme çift bildirim/tahakkuk yapar). Bunlar bir sonraki zamanlanmış çağrıya bırakılır.
# Son yanıt 200 değilse cron_heartbeats'e (iş, 'error', 'HTTP <kod> (çağrı)'; zaman aşımında 'zaman aşımı') yazılır:
# rota hiç çalışamadığında da (uygulama çökük, yetki/yapılandırma hatası) panel ve uyarı motoru işi "hatalı" görür. Rota
# aynı çağrıda kendi hata nabzını yazdıysa onun ayrıntısı korunur (yeni ayrıntının arkasına eklenir). İş adı = rota
# klasörü (/api/cron/<iş>; recordHeartbeat ile aynı ad, npm run check:cron doğrular). Nabız yazılamazsa yalnız günlüğe
# düşer. Ayrıntı: docs/runbooks/IZLEME.md.
# Ortam (yalnız test): CRON_ENV_FILE, CRON_LOCK_DIR, CRON_RETRY_DELAY (sn).
set -uo pipefail
ROUTE=${1:?kullanım: cron-call.sh /api/cron/<iş>}
ENV_FILE=${CRON_ENV_FILE:-/root/emlaksoft/.env.production}
LOCK_DIR=${CRON_LOCK_DIR:-/run/lock}
RETRY_DELAY=${CRON_RETRY_DELAY:-30}
DB=supabase-db-moqbebljyeyprktd19zb1ihn
JOB=$(basename "${ROUTE%%\?*}")
SECRET=$(grep -E '^CRON_SECRET=' "$ENV_FILE" | cut -d= -f2-)
LOCK=$LOCK_DIR/emlaksoft-cron-$JOB.lock
exec 9>"$LOCK"
flock -n 9 || { echo "$(date -u +%FT%TZ) $ROUTE atlandı (önceki sürüyor)"; exit 0; }

# Çıktı: "<http kodu> <curl çıkış kodu> <süre sn>". docker exec, curl'ün çıkış kodunu aynen döndürür.
# Gizli anahtar komut satırında GEÇMEZ (ps / /proc/<pid>/cmdline ile hem sunucuda hem konteynerde görünürdü):
# Authorization başlığı stdin'den beslenir (docker exec -i + curl -H @-; here-string kabukta kalır, ayrı süreç açmaz).
call_route() {
  local code rc start=$SECONDS
  code=$(docker exec -i emlaksoft-app curl -s -o /dev/null -w '%{http_code}' --max-time 300 \
    -H @- -H "User-Agent: emlaksoft-cron/1.0" "http://127.0.0.1:3000$ROUTE" 2>/dev/null <<< "Authorization: Bearer $SECRET")
  rc=$?
  [[ "$code" =~ ^[0-9]{3}$ ]] || code=000
  printf '%s %s %s' "$code" "$rc" "$((SECONDS - start))"
}

# Rota hiç çalışmadıysa 0 (yeniden denenebilir).
not_started() {
  local code=$1 rc=$2 dur=$3
  case "$code" in
    502|503|504) return 0 ;;
    000) [ "$rc" != 28 ] && [ "$dur" -lt 290 ] ;;
    *) return 1 ;;
  esac
}

STARTED=$(date -u +%Y-%m-%dT%H:%M:%S.%6NZ)
read -r CODE RC DUR <<< "$(call_route)"
if [ "$CODE" != 200 ] && not_started "$CODE" "$RC" "$DUR"; then
  echo "$(date -u +%FT%TZ) $ROUTE $CODE — rota çalışmadı, ${RETRY_DELAY} sn sonra yeniden denenecek"
  sleep "$RETRY_DELAY"
  read -r CODE RC DUR <<< "$(call_route)"
fi
TIMEOUT=0
if [ "$CODE" = 000 ] && { [ "$RC" = 28 ] || [ "$DUR" -ge 290 ]; }; then TIMEOUT=1; fi
echo "$(date -u +%FT%TZ) $ROUTE $CODE$([ "$TIMEOUT" = 1 ] && echo ' (zaman aşımı; yeniden denenmedi)')"
[ "$CODE" = 200 ] && exit 0

# Başarısız: hata nabzı. Değerler psql değişkeni (:'ad') olarak geçer; SQL'e metin birleştirilmez.
if [ "$TIMEOUT" = 1 ]; then DETAIL="zaman aşımı (çağrı, ${DUR} sn)"; else DETAIL="HTTP $CODE (çağrı)"; fi
if ! [[ "$JOB" =~ ^[a-z0-9][a-z0-9-]{0,79}$ ]]; then
  echo "$(date -u +%FT%TZ) $ROUTE nabız yazılmadı (geçersiz iş adı)"
  exit 1
fi
docker exec -i "$DB" psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 \
  -v job="$JOB" -v detail="$DETAIL" -v since="$STARTED" <<'SQL' >/dev/null 2>&1 || echo "$ROUTE hata nabzı yazılamadı"
insert into public.cron_heartbeats (job, last_run_at, last_status, last_detail)
values (:'job', now(), 'error', :'detail')
on conflict (job) do update
  set last_run_at = excluded.last_run_at,
      last_status = 'error',
      last_detail = case
        when cron_heartbeats.last_status = 'error' and cron_heartbeats.last_run_at >= :'since'::timestamptz
             and coalesce(cron_heartbeats.last_detail, '') <> ''
          then left(excluded.last_detail || ' — ' || cron_heartbeats.last_detail, 500)
        else excluded.last_detail
      end;
SQL
exit 1
