#!/usr/bin/env bash
# SK1 Adım 0 taban ölçümü ve yayın sonrası karşılaştırma (SALT-OKUNUR: docker logs + SELECT; hiçbir şey yazmaz).
# Kullanım:
#   bash scripts/sunucu/sk1-olcum.sh                 → anlık görüntü (aşağıdaki metrikler, ~60 sn sürer)
#   bash scripts/sunucu/sk1-olcum.sh --yayin-probu 300 → 300 sn boyunca 1 sn aralıkla / ve /api/health; 5xx sayısı
#                                                       (B043 kabulü: bir yayın boyunca 0). Yayını başka terminalde başlatın.
# Metrikler (SK1 kabul ölçütleri):
#   - Kong: son KONG_SINCE (varsayılan 24h) içinde GET /auth/v1/user ve POST /auth/v1/token sayısı
#     (B019: user ≈ yalnız token yenileme kadar; taban 2026-10-15: 24 saatte 8349 user / 74 token)
#   - PostgREST: son 24 saatte "Schema cache loaded" sayısı (B044: yayın dışında 0)
#   - pg_stat_statements: GoTrue users sorgusu çağrı sayısı ve ortalama süresi (B019: çağrı hızı ≥%90 düşer)
#   - pg_stat_database.sessions artışı / dk ve supabase_auth_admin boşta bağlantı (B020: ≤20/dk, boşta ≥5)
#   - WAL üretimi KB/sn ve _supabase log_events ekleme hızı / sn (B015: ≥%80 düşer)
#   - load1 (sakin sunucu: <4)
set -euo pipefail
DB=${DB_CONTAINER:-supabase-db-moqbebljyeyprktd19zb1ihn}
SFX=${SUPABASE_SUFFIX:-moqbebljyeyprktd19zb1ihn}
SITE=${SITE:-https://emlaksoft.com.tr}
q() { docker exec "$DB" psql -U postgres -d "${2:-postgres}" -Atqc "$1"; }

if [ "${1:-}" = "--yayin-probu" ]; then
  n=${2:-300}; bad=0; total=0
  for _ in $(seq 1 "$n"); do
    for u in "$SITE/" "$SITE/api/health"; do
      c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$u" || echo 000)
      total=$((total + 1))
      case "$c" in 5*|000) bad=$((bad + 1)); echo "$(date -u +%T) $u → $c" ;; esac
    done
    sleep 1
  done
  echo "yayın probu: $total istek, 5xx/bağlantı hatası $bad"
  [ "$bad" = 0 ]
  exit
fi

echo "== SK1 ölçüm $(date -u +%FT%TZ) · load1 $(cut -d' ' -f1 /proc/loadavg)"
KONG_SINCE=${KONG_SINCE:-24h}
kong=$(docker logs --since "$KONG_SINCE" "supabase-kong-$SFX" 2>&1 || true)
echo "Kong $KONG_SINCE: GET /auth/v1/user $(grep -c '"GET /auth/v1/user' <<<"$kong" || true) · POST /auth/v1/token $(grep -c '"POST /auth/v1/token' <<<"$kong" || true)"
echo "PostgREST 24 saat: Schema cache loaded $(docker logs --since 24h "supabase-rest-$SFX" 2>&1 | grep -c 'Schema cache loaded' || true)"
q "select 'GoTrue users sorgusu: ' || coalesce(sum(calls),0) || ' çağrı, ort ' || coalesce(round((sum(total_exec_time)/nullif(sum(calls),0))::numeric,2),0) || ' ms (pg_stat_statements sıfırlanma: ' || coalesce((select stats_reset::text from pg_stat_statements_info),'?') || ')'
   from pg_stat_statements s join pg_roles r on r.oid = s.userid
   where r.rolname = 'supabase_auth_admin' and s.query ilike '%from%users%' and s.query ilike '%where%id%'"
q "select 'supabase_auth_admin bağlantı: ' || count(*) filter (where state = 'idle') || ' boşta / ' || count(*) || ' toplam' from pg_stat_activity where usename = 'supabase_auth_admin'"
s1=$(q "select sum(sessions) from pg_stat_database"); w1=$(q "select pg_current_wal_lsn()")
l1=$(q "select coalesce(sum(n_tup_ins),0) from pg_stat_user_tables where schemaname = '_analytics' and relname like 'log_events_%'" _supabase)
sleep 60
s2=$(q "select sum(sessions) from pg_stat_database"); w2=$(q "select pg_current_wal_lsn()")
l2=$(q "select coalesce(sum(n_tup_ins),0) from pg_stat_user_tables where schemaname = '_analytics' and relname like 'log_events_%'" _supabase)
echo "pg_stat_database.sessions artışı: $((s2 - s1)) / dk"
echo "WAL: $(q "select round(pg_wal_lsn_diff('$w2','$w1') / 1024.0 / 60, 1)") KB/sn · log_events ekleme: $(( (l2 - l1) / 60 )) / sn"
