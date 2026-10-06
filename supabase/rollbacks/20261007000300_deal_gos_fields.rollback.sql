-- Rollback: 20261007000300_deal_gos_fields
-- Girilen GOS referans no ve tapu randevu tarihleri SILINIR. Once dokum alin:
--   select id, gos_reference_no, title_deed_appointment_at from public.deals
--   where gos_reference_no is not null or title_deed_appointment_at is not null;
drop index if exists public.idx_deals_tenant_title_deed_at;
alter table public.deals drop constraint if exists deals_gos_reference_no_format;
alter table public.deals drop column if exists title_deed_appointment_at;
alter table public.deals drop column if exists gos_reference_no;
notify pgrst, 'reload schema';
