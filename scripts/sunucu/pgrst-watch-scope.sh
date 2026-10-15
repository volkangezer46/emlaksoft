#!/usr/bin/env bash
# SK1/B044: PostgREST şema yeniden yüklemesini yayınlanan şemalara (public, storage, graphql_public) sınırlar.
# extensions.pgrst_ddl_watch / pgrst_drop_watch fonksiyonlarının sahibi supabase_admin olduğu için migration aracı
# (`postgres`, süper kullanıcı değil) onları yeniden yazamaz: 20261016010100 migration'ı o rolde NOTICE ile no-op olur.
# Bu betik AYNI migration dosyasını yerel soketten supabase_admin ile tek işlemde çalıştırır (idempotent).
# Gece penceresinde, duyurularak çalıştırılır; anlık tek bir PostgREST yeniden yüklemesine yol açar.
# Geri alma: --geri-al (supabase/rollbacks/20261016010100_pgrst_ddl_watch_scope.rollback.sql).
# Doğrulama: --kontrol (değiştirmeden fonksiyon gövdesinde şema süzgeci var mı).
set -euo pipefail
cd "$(dirname "$0")/../.."
DB_CONTAINER=${DB_CONTAINER:-supabase-db-moqbebljyeyprktd19zb1ihn}
MIG=supabase/migrations/20261016010100_pgrst_ddl_watch_scope.sql
RB=supabase/rollbacks/20261016010100_pgrst_ddl_watch_scope.rollback.sql

check() {
  docker exec "$DB_CONTAINER" psql -U supabase_admin -d postgres -Atc \
    "select pg_catalog.pg_get_functiondef('extensions.pgrst_ddl_watch()'::regprocedure) like '%''graphql_public''%'
        and pg_catalog.pg_get_functiondef('extensions.pgrst_drop_watch()'::regprocedure) like '%''graphql_public''%'"
}

case "${1:-}" in
  --kontrol)
    if [ "$(check)" = "t" ]; then echo "pgrst watch: yalnız yayınlanan şemalar (SK1 uygulanmış)"; else echo "pgrst watch: özgün Supabase gövdesi (her şema)"; exit 1; fi
    ;;
  --geri-al)
    docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -1 -v ON_ERROR_STOP=1 -q < "$RB"
    echo "pgrst watch özgün gövdeye döndü"
    ;;
  "")
    docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -1 -v ON_ERROR_STOP=1 -q < "$MIG"
    [ "$(check)" = "t" ] || { echo "HATA: şema süzgeci uygulanmadı"; exit 1; }
    echo "pgrst watch yalnız public/storage/graphql_public için yeniden yazıldı"
    ;;
  *) echo "Kullanım: $0 [--kontrol|--geri-al]"; exit 2 ;;
esac
