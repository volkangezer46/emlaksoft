-- 20261013003400 geri alma: Google veri tablolari ve budama fonksiyonu duser (kod tablolar yokken "veri yok" gosterir,
-- cron adimi hatayi satir notuna yazar). platform_settings 'google.*' kayitlarina dokunulmaz (baglanti ekranindan kesilir).
drop function if exists public.seo_gsc_summary(integer, text, integer);
drop function if exists public.google_data_prune();
drop table if exists public.ads_daily_metrics;
drop table if exists public.seo_url_inspections;
drop table if exists public.seo_gsc_daily;
notify pgrst, 'reload schema';
