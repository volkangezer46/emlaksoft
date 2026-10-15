-- Geri alma: 20261016120400_tenant_vitrin_seo_meta.sql
-- Girilen vitrin SEO basligi/aciklamasi KAYBOLUR. Kod sutunlar yokken vitrin metadata'si SEO kalibina duser.
set local lock_timeout = '5s';
alter table public.tenants drop constraint if exists tenants_vitrin_seo_description_len;
alter table public.tenants drop constraint if exists tenants_vitrin_seo_title_len;
alter table public.tenants
  drop column if exists vitrin_seo_description,
  drop column if exists vitrin_seo_title;
notify pgrst, 'reload schema';
