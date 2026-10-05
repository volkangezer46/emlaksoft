-- Rollback: 20260825000100_properties_owner_customer_link (eski taslak adi 20261005000100). Elle, ters sirada calistirilir;
-- schema_migrations ledger satirina DOKUNMAZ.
-- UYARI: girilmis malik baglantilari KALICI silinir.
drop trigger if exists trg_properties_owner_same_tenant on public.properties;
drop function if exists public.properties_owner_same_tenant();
drop index if exists public.idx_properties_owner_customer;
alter table public.properties drop constraint if exists properties_owner_customer_id_fkey;
alter table public.properties drop column if exists owner_customer_id;
