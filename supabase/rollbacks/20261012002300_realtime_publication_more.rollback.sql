-- 20261012002300 geri alma: teklif, kira tahakkuku/ödemesi ve anahtar tabloları realtime yayınından çıkar (istemci ayrı kanalda sessiz kalır).
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach t in array array['offers', 'rent_charges', 'rent_payments', 'property_keys'] loop
    if exists (select 1 from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute pg_catalog.format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end
$$;
