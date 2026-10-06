-- Rollback: 20261006000600_purge_sample_data_rpc. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- Yalniz fonksiyon duser; veri kaybi yok. Kod RPC yokken eski yola (uygulama katmaninda tablo tablo silme,
-- src/lib/sample-clear.ts) kendiliginden duser.
drop function if exists public.purge_tenant_sample_data(uuid);
-- UYARI: sihirbazda girilen ofis turu / odak / calisilan ilce bilgileri KAYBOLUR.
alter table public.tenants drop constraint if exists tenants_work_district_ids_check;
alter table public.tenants drop constraint if exists tenants_focus_segments_check;
alter table public.tenants drop constraint if exists tenants_office_type_check;
alter table public.tenants drop column if exists work_district_ids;
alter table public.tenants drop column if exists focus_segments;
alter table public.tenants drop column if exists office_type;
notify pgrst, 'reload schema';
