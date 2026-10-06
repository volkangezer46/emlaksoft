-- ROLLBACK 20261006000410_dashboard_snapshot_rpcs.sql
-- Yalniz 3 fonksiyonu dusurur; tablo/politika/veri degismemisti. Kod fonksiyonlar yokken mevcut sorgulara duser.

drop function if exists public.get_metrics_snapshot(uuid, uuid);
drop function if exists public.get_tasks_snapshot(uuid, uuid);
drop function if exists public.get_insights_snapshot(uuid);
