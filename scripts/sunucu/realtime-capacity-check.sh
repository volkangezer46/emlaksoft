#!/usr/bin/env bash
# SK2 (B014) Realtime kapasite uyarisi: eszamanli kullanici sayisi kiraci sinirinin (_realtime.tenants
# max_concurrent_users) %80'ine yaklasinca uyari dusurur. Sinir dolunca yeni sekmeler canli veri alamaz (katilim reddi;
# istemci telemetrisi ayrica 'rt:LIMIT:*' parmak izi yazar, src/lib/realtime.ts).
#
# Olcum: Realtime'in kendi sayaci (Realtime.UsersCounter.tenant_users; max_concurrent_users kapisi bunu kullanir),
#   konteynerde `bin/realtime rpc` ile salt-okunur okunur. Sinir: _realtime.tenants (salt-okunur SELECT).
# Uyari: esik asilinca public.error_logs'a TEK satir (parmak izi 'rt:capacity', source 'server', yol '/realtime';
#   tekrarlar ayni satirin occurrences sayacini arttirir) -> /admin/sistem?sekme=hatalar + error-watch.sh hata akisi +
#   uygulama ici "hata patlamasi" kurali. Ayni uyari en sik REPEAT_MIN dakikada bir yazilir (durum dosyasi).
#
# KURULUM (sahibin/ana oturumun adimi; bir kez):
#   printf '%s\n' '* * * * * root /root/emlaksoft/scripts/sunucu/realtime-capacity-check.sh >> /var/log/emlaksoft/realtime-capacity.log 2>&1' \
#     > /etc/cron.d/emlaksoft-realtime-capacity && chmod 644 /etc/cron.d/emlaksoft-realtime-capacity
# Elle deneme (yazmadan): RT_CAPACITY_DRY=1 scripts/sunucu/realtime-capacity-check.sh
# Test: RT_CAPACITY_FAKE_CONNECTED / RT_CAPACITY_FAKE_MAX (olcum yerine), RT_CAPACITY_STATE (durum dosyasi),
#   RT_CAPACITY_DRY=1 (DB'ye yazmaz; karar satirini basar).
set -uo pipefail
DB=${RT_CAPACITY_DB:-supabase-db-moqbebljyeyprktd19zb1ihn}
RT=${RT_CAPACITY_RT:-realtime-dev-moqbebljyeyprktd19zb1ihn}
TENANT=${RT_CAPACITY_TENANT:-realtime-dev}
PCT=${RT_CAPACITY_PCT:-80}
REPEAT_MIN=${RT_CAPACITY_REPEAT_MIN:-30}
STATE=${RT_CAPACITY_STATE:-/run/emlaksoft/realtime-capacity.state}
DRY=${RT_CAPACITY_DRY:-0}
ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

if [[ ! "$TENANT" =~ ^[a-z0-9-]+$ ]]; then
  echo "$(ts) realtime-capacity: gecersiz kiraci adi" >&2
  exit 2
fi

if [ -n "${RT_CAPACITY_FAKE_MAX:-}" ]; then
  MAX=$RT_CAPACITY_FAKE_MAX
else
  MAX=$(docker exec "$DB" psql -U postgres -d postgres -At -X \
    -c "select max_concurrent_users from _realtime.tenants where external_id = '$TENANT'" 2>/dev/null | tr -d '[:space:]')
fi
if [ -n "${RT_CAPACITY_FAKE_CONNECTED:-}" ]; then
  CONNECTED=$RT_CAPACITY_FAKE_CONNECTED
else
  CONNECTED=$(docker exec "$RT" /app/bin/realtime rpc "IO.puts(Realtime.UsersCounter.tenant_users(\"$TENANT\"))" 2>/dev/null \
    | tail -n 1 | tr -d '[:space:]')
fi

if [[ ! "$MAX" =~ ^[0-9]+$ ]] || [[ ! "$CONNECTED" =~ ^[0-9]+$ ]] || [ "$MAX" -eq 0 ]; then
  echo "$(ts) realtime-capacity: olculemedi (max='${MAX:-}', bagli='${CONNECTED:-}')"
  exit 0
fi

USED=$(( CONNECTED * 100 / MAX ))
echo "$(ts) realtime-capacity: bagli=$CONNECTED sinir=$MAX kullanim=%$USED esik=%$PCT"
if [ "$USED" -lt "$PCT" ]; then
  exit 0
fi

NOW=$(date +%s)
LAST=$(cat "$STATE" 2>/dev/null | tr -dc '0-9')
if [ -n "$LAST" ] && [ $(( NOW - LAST )) -lt $(( REPEAT_MIN * 60 )) ]; then
  echo "$(ts) realtime-capacity: esik asildi, uyari $REPEAT_MIN dk icinde zaten yazildi"
  exit 0
fi

MSG="Realtime eszamanli kullanici siniri: $CONNECTED / $MAX (%$USED, esik %$PCT). Sinir dolunca yeni sekmeler canli veri alamaz; scripts/sunucu/realtime-limits.sql"
if [ "$DRY" = "1" ]; then
  echo "$(ts) realtime-capacity: UYARI (deneme, yazilmadi): $MSG"
  exit 0
fi

if docker exec -i "$DB" psql -U postgres -d postgres -At -X -v ON_ERROR_STOP=1 -v msg="$MSG" >/dev/null <<'SQL'
begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.record_error_occurrence(null, null, 'server', null, :'msg', null, '/realtime', null, 'rt:capacity', null);
commit;
SQL
then
  mkdir -p "$(dirname "$STATE")"
  echo "$NOW" > "$STATE"
  echo "$(ts) realtime-capacity: UYARI yazildi (error_logs rt:capacity)"
else
  echo "$(ts) realtime-capacity: uyari yazilamadi" >&2
  exit 1
fi
