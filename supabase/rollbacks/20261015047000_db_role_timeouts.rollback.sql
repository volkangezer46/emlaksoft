-- Geri alma: 20261015047000_db_role_timeouts.sql
-- Eklenen ayarlar kaldirilir: idle_in_transaction_session_timeout (4 rol), service_role statement_timeout ve (superuser ise)
-- veritabani log_min_duration_statement. anon 3s / authenticated 8s / authenticator 8s statement_timeout degerleri
-- migration'dan ONCE de Supabase varsayilaniydi; geri almada BILEREK korunur (sinirsiz birakilmaz).
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'authenticator', 'service_role'] loop
    if exists (select 1 from pg_catalog.pg_roles where rolname = r) then
      execute format('alter role %I reset idle_in_transaction_session_timeout', r);
    end if;
  end loop;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    alter role service_role reset statement_timeout;
  end if;
  if coalesce((select rolsuper from pg_catalog.pg_roles where rolname = current_user), false) then
    execute format('alter database %I reset log_min_duration_statement', current_database());
  end if;
end $$;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
