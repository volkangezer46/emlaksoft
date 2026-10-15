-- Geri alma: 20261016020100_realtime_publication_trim.sql
-- Kirpmadan once canlidaki supabase_realtime yayininda olan sayfa tablolari (2026-10-15 salt-okunur pg_publication_tables;
-- 21 tablonun 19'u) STATIK listeden geri eklenir: eski (postgres_changes) istemciye donulurse canli veri yeniden akar.
-- Tablo yoksa ya da zaten yayindaysa atlanir. Veri degismez. Idempotent.
set local lock_timeout = '5s';

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise notice 'SK2 geri alma: supabase_realtime yok, atlandi';
    return;
  end if;
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime' and puballtables) then
    return;
  end if;
  foreach t in array array[
    'appointments', 'cash_entries', 'commissions', 'customer_demands', 'customers', 'deals', 'finance_open_items',
    'finance_parties', 'fsbo_leads', 'listing_control_events', 'listing_pool_entries', 'notifications', 'offers',
    'portal_listings', 'properties', 'property_keys', 'rent_charges', 'rent_payments', 'tasks'
  ] loop
    if pg_catalog.to_regclass('public.' || t) is null then
      continue;
    end if;
    if exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      continue;
    end if;
    execute pg_catalog.format('alter publication supabase_realtime add table public.%I', t);
  end loop;
end $$;
