#!/usr/bin/env bash
# Bulut Supabase pg_dump (-Fc, yetkilerle) → self-hosted Supabase geri yükleme.
# Önkoşul: hedefte GoTrue/Storage göçleri bulutla aynı ya da daha yeni sürümde
# uygulanmış olmalı (auth/storage şemaları servislerce kurulur, buradan yalnız veri gelir).
#
# Kullanım: restore-cloud-dump.sh <dump> <docker-ağı> <db-host> <supabase_admin-parolası>
# Prova (2026-10-13): 287 tablo / 41.448 satır birebir, check:migrations --database
# ve db:rls-audit temiz.
set -euo pipefail
DUMP=$(realpath "$1"); NET=$2; HOST=$3; PW=$4
IMG=supabase/postgres:17.6.1.178
DIR=$(dirname "$DUMP"); BASE=$(basename "$DUMP")
HERE=$(cd "$(dirname "$0")" && pwd)

docker run --rm -v "$DIR":/b $IMG pg_restore -l "/b/$BASE" > "$DIR/$BASE.toc"
python3 -I "$HERE/restore-list.py" "$DIR/$BASE.toc" > "$DIR/$BASE.list"

# Veri yüklenirken tetikleyiciler/FK denetimleri kapalı (session_replication_role).
# `ensure_rls` olay tetikleyicisi supabase_admin ile kurulamaz → sonra postgres ile.
docker run --rm --network "$NET" -v "$DIR":/b -e PGPASSWORD="$PW" \
  -e PGOPTIONS='-c session_replication_role=replica' $IMG \
  pg_restore -h "$HOST" -U supabase_admin -d postgres -L "/b/$BASE.list" "/b/$BASE" \
  2>&1 | tee "$DIR/$BASE.restore.log" || true

docker run --rm --network "$NET" -e PGPASSWORD="$PW" $IMG \
  psql -h "$HOST" -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c \
  "SET ROLE postgres; DROP EVENT TRIGGER IF EXISTS ensure_rls;
   CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
     WHEN TAG IN ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')
     EXECUTE FUNCTION public.rls_auto_enable();"

# Güvenlik ağı: sahipli her sayacı sütun azamisinin ötesine taşı (2026-10-13 olayı: refresh_tokens_pkey çakışması → giriş 500).
docker run --rm --network "$NET" -e PGPASSWORD="$PW" $IMG \
  psql -h "$HOST" -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "
do \$\$ declare r record; mx bigint; begin
for r in select n.nspname sch, s.relname seq, tn.nspname tsch, t.relname tbl, a.attname col
  from pg_class s join pg_namespace n on n.oid=s.relnamespace
  join pg_depend d on d.objid=s.oid and d.deptype in ('a','i')
  join pg_class t on t.oid=d.refobjid join pg_namespace tn on tn.oid=t.relnamespace
  join pg_attribute a on a.attrelid=t.oid and a.attnum=d.refobjsubid
  where s.relkind='S' and n.nspname in ('auth','storage','public')
loop
  execute format('select max(%I)::bigint from %I.%I', r.col, r.tsch, r.tbl) into mx;
  if mx is not null then execute format('select setval(%L, greatest(%s, (select last_value from %I.%I)))', r.sch||'.'||r.seq, mx, r.sch, r.seq); end if;
end loop; end \$\$;"

echo "pg_restore hataları (yalnız ensure_rls ile ilgili 2 hata beklenir):"
grep 'error:' "$DIR/$BASE.restore.log" || true

# Son denetimler (salt-okunur): yukarıdaki düzeltmeden sonra sayaç kayması kalmamalı ...
echo "Sayaç denetimi (check-sequences.sql, yalnız rapor):"
docker run --rm --network "$NET" -v "$HERE":/s:ro -e PGPASSWORD="$PW" $IMG \
  psql -h "$HOST" -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -f /s/check-sequences.sql \
  || echo "[uyari] sayaç denetimi çalışmadı"
# ... ve yetki (ACL) farkı: dökümdeki anon REVOKE'ları hedefte kaybolabilir (bkz. restore-list.py).
# check:acl yoksa (--if-present) sessiz geçer; başarısızlık geri yüklemeyi geri almaz, elle incelenir.
(cd "$HERE/../.." && npm run --if-present check:acl) || echo "[uyari] ACL denetimi başarısız — farkı inceleyin"
