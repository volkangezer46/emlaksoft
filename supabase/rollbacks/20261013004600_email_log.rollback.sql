-- 20261013004600 geri alma: e-posta günlüğü, olaylar, bastırma listesi ve budama RPC'si düşer (kod tablolar yokken
-- gönderime devam eder, günlük/bastırma sessizce atlanır, ekran "kurulum bekliyor" der). Başka nesneye dokunmaz.
drop function if exists public.email_log_prune();
drop table if exists public.email_events;
drop table if exists public.email_suppressions;
drop table if exists public.email_sends;
notify pgrst, 'reload schema';
