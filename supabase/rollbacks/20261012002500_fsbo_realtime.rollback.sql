-- 20261012002500 geri alma: fsbo_leads realtime yayınından çıkar, kapatma RPC'si düşer.
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and exists (select 1 from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fsbo_leads') then
    alter publication supabase_realtime drop table public.fsbo_leads;
  end if;
end
$$;
drop function if exists public.insight_close_fsbo_lead(uuid);
