-- MIGRATION 20261015047000_db_role_timeouts.sql
-- YD7 (2026-10-15): Postgres rol duzeyinde koruyucu zaman asimlari + yavas sorgu gunlugu.
-- Geri alma: supabase/rollbacks/20261015047000_db_role_timeouts.rollback.sql
--
-- AMAC: 13 Ekim olayinda DB yanit veremedi; kacak bir istek (uzun sorgu ya da acik birakilan islem) baglanti ve kilitleri
--   suresiz tutabiliyordu. pg_settings: statement_timeout=0, idle_in_transaction_session_timeout=0,
--   log_min_duration_statement=-1 (yavas sorgu gorunmuyordu).
--
-- NE YAPAR:
--   * statement_timeout (rol duzeyi): anon 3s, authenticated 8s, authenticator 8s (Supabase varsayilanlari; canlida zaten
--     bu degerler var, burada tekrarlanabilir kayda alinir; GEVSETILMEZ). service_role 60s: PostgREST service_role'u
--     taklit ederken o rolun ayarini uygular; ayar yokken authenticator oturumunun 8s'i gecerliydi. Sunucu/cron yollari
--     (tek service_role istemcisi) boylece kullanici isteklerinden DAHA UZUN pay alir, kisalmaz.
--   * idle_in_transaction_session_timeout 60s: anon / authenticated / authenticator / service_role. PostgREST islemleri
--     milisaniyeler surer; 60 sn bos bekleyen islem ancak kopuk istemcidir ve kilidi birakir.
--   * log_min_duration_statement 1s (veritabani duzeyi): yalniz superuser ayarlayabilir (PGC_SUSET). Migration superuser
--     DEGILSE (Supabase'te `postgres` superuser degil) adim ATLANIR ve NOTICE yazilir; canlida supabase_admin ile
--     `alter database postgres set log_min_duration_statement = '1s'` calistirilir (YAYIN NOTU). Rol duzeyine BILEREK
--     yazilmaz: PostgREST taklit edilen rolun ayarlarini set_config ile uygular ve SUSET bir parametre tum istekleri kirar.
--   * DOKUNULMAYAN roller: postgres, supabase_admin, supabase_auth_admin (auth zaten 60s idle), supabase_storage_admin,
--     realtime/pooler rolleri. Migration ve bakim isleri `postgres` ile calisir: etkilenmez.
-- ETKI: yalniz rol/veritabani ayari (yeni baglantida ve PostgREST yapilandirma yenilemesinde gecerli). Tablo/veri degismez.
-- IDEMPOTENT: ayni degerler yeniden yazilir.

set local lock_timeout = '5s';

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('anon', '3s'),
      ('authenticated', '8s'),
      ('authenticator', '8s'),
      ('service_role', '60s')
    ) as v(role_name, stmt_timeout)
  loop
    if exists (select 1 from pg_catalog.pg_roles where rolname = r.role_name) then
      execute format('alter role %I set statement_timeout = %L', r.role_name, r.stmt_timeout);
      execute format('alter role %I set idle_in_transaction_session_timeout = %L', r.role_name, '60s');
    else
      raise notice 'rol % yok; zaman asimi atlandi', r.role_name;
    end if;
  end loop;

  if coalesce((select rolsuper from pg_catalog.pg_roles where rolname = current_user), false) then
    execute format('alter database %I set log_min_duration_statement = %L', current_database(), '1s');
  else
    raise notice 'log_min_duration_statement atlandi: % superuser degil (supabase_admin ile elle ayarlanir)', current_user;
  end if;
end $$;

-- PostgREST taklit edilen rol ayarlarini yapilandirma yuklemesinde okur.
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
