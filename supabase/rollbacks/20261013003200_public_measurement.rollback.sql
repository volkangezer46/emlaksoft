-- 20261013003200 geri alma: ölçüm sayaçları ve RPC'leri düşer (kod RPC yokken beacon tamponu yazmayı 10 dk arayla
-- yeniden dener, site etkilenmez). 20261013003220 (platform_growth_funnel) bu tabloyu okur: önce o geri alınmalı.
drop function if exists public.analytics_vitals_summary(date, date);
drop function if exists public.analytics_prune(integer, integer);
drop function if exists public.analytics_ingest(jsonb);
drop table if exists public.web_vitals_daily;
drop table if exists public.public_pageviews_daily;
notify pgrst, 'reload schema';
