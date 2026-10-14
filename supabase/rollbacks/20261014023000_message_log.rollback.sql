-- 20261014023000 geri alma: SMS/WhatsApp gönderim günlüğü ve budama RPC'si düşer (kod tablo yokken gönderime devam eder,
-- günlük sessizce atlanır, ekran "kurulum bekliyor" der). Başka nesneye dokunmaz.
drop function if exists public.message_log_prune();
drop table if exists public.message_sends;
notify pgrst, 'reload schema';
