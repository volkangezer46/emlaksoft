-- 20261014004000 geri alma: DG4 kayitli rapor gorunumleri ve zamanlanmis rapor abonelikleri duser (kod tablolar yokken
-- rapor merkezinde "kurulum bekliyor" gosterir, gunluk-ozet cron adimi 'skipped' gecer). Baska nesneye dokunmaz.
drop function if exists public.report_subscription_leave(uuid);
drop table if exists public.report_subscription_runs;
drop table if exists public.report_subscriptions;
drop table if exists public.report_saved_views;
drop function if exists public.report_subscriptions_guard();
notify pgrst, 'reload schema';
