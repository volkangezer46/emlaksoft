-- 20261013001000 geri alma: MRR anlik goruntu tablosu duser (kod tablo yokken egriyi "veri yok" gosterir, cron adimi hatayi yutar).
drop table if exists public.platform_mrr_daily;
notify pgrst, 'reload schema';
