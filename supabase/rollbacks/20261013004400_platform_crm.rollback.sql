-- 20261013004400 geri alma: AD5 Ofis CRM tablolari ve saglik girdisi fonksiyonu duser (kod tablolar yokken
-- "CRM kurulumu bekliyor" gosterir, cron adimi 'skipped' gecer). Baska nesneye dokunmaz.
drop function if exists public.platform_tenant_health_inputs(timestamptz, timestamptz);
drop table if exists public.admin_saved_views;
drop table if exists public.tenant_health_daily;
drop table if exists public.platform_tasks;
drop table if exists public.platform_tenant_notes;
drop table if exists public.platform_tenant_crm;
drop table if exists public.tenant_tag_links;
drop table if exists public.tenant_tags;
notify pgrst, 'reload schema';
