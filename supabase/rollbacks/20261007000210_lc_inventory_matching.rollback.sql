-- Rollback: 20261007000210_lc_inventory_matching. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- Iki JWT RPC ve ice aktarma ozet tablosu DUSER. Daha once yazilmis gozlemler (listing_verifications), eslesme adaylari,
-- baglanan portal ilanlari ve 'unregistered_listing' anomalileri KALIR (cekirdek tablolar). Kod RPC yokken envanter ve
-- eslesme ekranlarinda "etkin degil" der.

set local lock_timeout = '5s';

drop function if exists public.lc_inventory_import(text, text, text, boolean, jsonb, jsonb, jsonb);
drop function if exists public.lc_match_decide(uuid, text, uuid);
drop table if exists public.listing_inventory_imports;

notify pgrst, 'reload schema';
