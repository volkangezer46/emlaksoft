-- MIGRATION 20261012002300_realtime_publication_more.sql
-- Canlı veri: merkez sayfalarında (Anlaşmalar > Teklifler, Mülk yönetimi > Kiralar, Portföyler > Anahtarlar) başka
-- kullanıcının değişikliği sayfa yenilenmeden görünsün. 20261011000800 çekirdek ve genişletilmiş tabloları yayına
-- almıştı; bu dosya teklif, kira tahakkuku/ödemesi ve anahtar tablolarını ekler.
-- Realtime postgres_changes RLS'e tabidir; istemci ayrıca tenant_id=eq süzer. İdempotent: yayında olan atlanır. Tablo/veri değişmez.

set local lock_timeout = '5s';

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime yayını yok; atlandı';
    return;
  end if;
  foreach t in array array['offers', 'rent_charges', 'rent_payments', 'property_keys'] loop
    if pg_catalog.to_regclass('public.' || t) is not null
       and not exists (select 1 from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute pg_catalog.format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
