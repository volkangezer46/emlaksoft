-- MIGRATION 20261016010100_pgrst_ddl_watch_scope.sql
-- SK1 / B044 (2026-10-16): PostgREST şema yeniden yüklemesi yalnız yayınlanan şemalardaki DDL'de.
-- Geri alma: supabase/rollbacks/20261016010100_pgrst_ddl_watch_scope.rollback.sql
--
-- NEDEN: Supabase'in extensions.pgrst_ddl_watch / pgrst_drop_watch event trigger fonksiyonları HER şemadaki DDL'de
--   'NOTIFY pgrst, reload schema' gönderir. Canlıda 24 saatte 51 yeniden yükleme (ort. 489, maks 1120 ms); her biri
--   PostgREST bağlantı havuzunu baştan kurar, ilk RPC'ler 7-15 kat yavaşlar (proxy_gate 22,4 ms vs 1,1 ms). Yayın
--   dışındaki yüklemeler (01:05, 01:35 UTC) realtime.messages günlük bölüm DDL'i ve auth/cron/net şemalarındaki
--   iç DDL'den geliyor: PostgREST bu şemaları HİÇ yayınlamaz (PGRST_DB_SCHEMAS = public, storage, graphql_public).
-- NE YAPAR: iki fonksiyon aynı komut/nesne listesiyle yeniden yazılır; ek koşul: nesnenin şeması yayınlanan
--   şemalardan biri (ya da şema DDL'inin kendisi bu şemalardan biri). Diğer şemalardaki DDL yeniden yükleme TETİKLEMEZ.
--   Şema listesi iki fonksiyonda sabit (PGRST_DB_SCHEMAS değişirse ikisi birlikte güncellenir). Yardımcı fonksiyon
--   bilerek YOK: event trigger fonksiyonu DDL'i çalıştıran rolün yetkisiyle koşar; extensions şemasında USAGE'ı
--   olmayan bir rolün (ör. realtime bölüm DDL'i) iç çağrısı hata verip DDL'i düşürürdü.
-- YETKİ: fonksiyonların sahibi supabase_admin'dir; migration aracı `postgres` (süper kullanıcı DEĞİL) ile bağlanır.
--   Bu yüzden yeniden yazma YALNIZ çalıştıran rol fonksiyonun sahibi (ya da süper kullanıcı) ise yapılır; değilse
--   NOTICE basılır ve hiçbir şey değişmez (ledger'a yine işlenir). Uygulama: `bash scripts/sunucu/pgrst-watch-scope.sh`
--   aynı dosyayı supabase_admin ile çalıştırır (yerel soket, gece penceresi; idempotent). Fonksiyon yoksa (Supabase dışı
--   veritabanı) atlanır.
-- ETKİ: yayın sırasında release.sh iki event trigger'ı zaten kapatır (tek NOTIFY yayın sonunda); bu dosya YAYIN DIŞI
--   gereksiz yüklemeleri durdurur. public/storage/graphql_public'teki her DDL eskisi gibi yeniden yükler.
-- VERİ: değişiklik yok. IDEMPOTENT.

set local lock_timeout = '5s';

do $outer$
declare
  v_owner_ok boolean;
begin
  if pg_catalog.to_regprocedure('extensions.pgrst_ddl_watch()') is null
     or pg_catalog.to_regprocedure('extensions.pgrst_drop_watch()') is null then
    raise notice '20261016010100: extensions.pgrst_*_watch yok (Supabase disi veritabani); atlandi.';
    return;
  end if;

  select bool_and(pg_catalog.pg_has_role(current_user, p.proowner, 'USAGE'))
         or coalesce((select r.rolsuper from pg_catalog.pg_roles r where r.rolname = current_user), false)
    into v_owner_ok
    from pg_catalog.pg_proc p
   where p.oid in ('extensions.pgrst_ddl_watch()'::regprocedure, 'extensions.pgrst_drop_watch()'::regprocedure);

  if not coalesce(v_owner_ok, false) then
    raise notice '20261016010100: % pgrst_*_watch sahibi degil; degisiklik YAPILMADI. Uygulama: bash scripts/sunucu/pgrst-watch-scope.sh (supabase_admin).', current_user;
    return;
  end if;

  execute $ddl$
    create or replace function extensions.pgrst_ddl_watch()
    returns event_trigger
    language plpgsql
    as $f$
    declare
      cmd record;
    begin
      for cmd in select * from pg_catalog.pg_event_trigger_ddl_commands()
      loop
        if cmd.command_tag in (
          'CREATE SCHEMA', 'ALTER SCHEMA'
        , 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE'
        , 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE'
        , 'CREATE VIEW', 'ALTER VIEW'
        , 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW'
        , 'CREATE FUNCTION', 'ALTER FUNCTION'
        , 'CREATE TRIGGER'
        , 'CREATE TYPE', 'ALTER TYPE'
        , 'CREATE RULE'
        , 'COMMENT'
        )
        and cmd.schema_name is distinct from 'pg_temp'
        -- SK1/B044: yalnız PostgREST'in yayınladığı şemalar. Şema DDL'inde schema_name null olur: nesne kimliği şemadır.
        -- Liste supabase-rest PGRST_DB_SCHEMAS ile AYNI tutulur (iki fonksiyonda da; yardımcı fonksiyon YOK: DDL'i
        -- çalıştıran her rol extensions şemasında USAGE taşımayabilir, iç çağrı DDL'i düşürürdü).
        and coalesce(cmd.schema_name, cmd.object_identity) in ('public', 'storage', 'graphql_public')
        then
          notify pgrst, 'reload schema';
          return;
        end if;
      end loop;
    end;
    $f$
  $ddl$;

  execute $ddl$
    create or replace function extensions.pgrst_drop_watch()
    returns event_trigger
    language plpgsql
    as $f$
    declare
      obj record;
    begin
      for obj in select * from pg_catalog.pg_event_trigger_dropped_objects()
      loop
        if obj.object_type in (
          'schema'
        , 'table'
        , 'foreign table'
        , 'view'
        , 'materialized view'
        , 'function'
        , 'trigger'
        , 'type'
        , 'rule'
        )
        and obj.is_temporary is false
        -- SK1/B044: yalnız yayınlanan şemalar (şema düşürmede schema_name null: nesne adı şemadır).
        and coalesce(obj.schema_name, obj.object_name) in ('public', 'storage', 'graphql_public')
        then
          notify pgrst, 'reload schema';
          return;
        end if;
      end loop;
    end;
    $f$
  $ddl$;

  execute $ddl$
    comment on function extensions.pgrst_ddl_watch() is
      'SK1/B044: PostgREST yeniden yuklemesi yalniz yayinlanan semalardaki (public, storage, graphql_public) DDL icin; tek NOTIFY.'
  $ddl$;
  raise notice '20261016010100: pgrst_*_watch yalniz public/storage/graphql_public icin yeniden yazildi.';
end
$outer$;
