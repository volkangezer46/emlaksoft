-- 20261011000800 geri alma: eklenen tabloları supabase_realtime yayınından çıkarır.
do $$
declare
  t text;
begin
  foreach t in array array['properties', 'customer_demands', 'appointments', 'tasks', 'listing_pool_entries', 'cash_entries'] loop
    if exists (select 1 from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute pg_catalog.format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end
$$;
