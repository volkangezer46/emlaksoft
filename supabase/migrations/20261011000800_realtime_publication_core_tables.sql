-- MIGRATION 20261011000800_realtime_publication_core_tables.sql
-- "Önce göster, sonra tazele" (istemci önbelleği staleTimes 300 sn): ekipten gelen değişiklik açık sayfayı
-- Supabase Realtime ile tazeler. supabase_realtime yayınında yalnız customers/deals/commissions/portal_listings vardı;
-- portföy, talep, randevu, görev, havuz ve kasa hareketleri olay üretmiyordu. Bu dosya onları yayına ekler.
-- Realtime postgres_changes RLS'e tabidir (aboneye yalnız görebildiği satır gider); istemci ayrıca tenant_id=eq süzer.
-- İdempotent: tablo zaten yayındaysa atlanır. Tablo/veri değişmez.

set local lock_timeout = '5s';

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime yayını yok; atlandı';
    return;
  end if;
  foreach t in array array['properties', 'customer_demands', 'appointments', 'tasks', 'listing_pool_entries', 'cash_entries'] loop
    if pg_catalog.to_regclass('public.' || t) is not null
       and not exists (select 1 from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute pg_catalog.format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
