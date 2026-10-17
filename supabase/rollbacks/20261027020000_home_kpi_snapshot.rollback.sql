-- ROLLBACK 20261027020000_home_kpi_snapshot.sql
-- Yalniz uc yeni fonksiyonu dusurur; tablo/politika/veri degismemisti. Kod fonksiyon yokken eski KPI/satis sorgularina duser.

drop function if exists public.home_sales_windows(text, timestamptz, jsonb, boolean, text, uuid);
drop function if exists public.home_kpi_snapshot(text, timestamptz, boolean, timestamptz);
drop function if exists public.home_kpi_week_buckets(timestamptz[], timestamptz, integer);
