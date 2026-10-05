-- Rollback: 20260826001800_tenant_license_details. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- UYARI: girilmis yetki belgesi unvani/gecerlilik tarihleri KAYBOLUR.
alter table public.tenants drop constraint if exists tenants_license_title_len_check;
alter table public.tenants drop column if exists license_valid_until;
alter table public.tenants drop column if exists license_title;
