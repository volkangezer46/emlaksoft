-- 20261013003300 geri alma: hiz laboratuvari olcum gecmisi duser (kod tablo yokken "migration bekliyor" gosterir,
-- cron "atlandi" yazar). platform_settings anahtarlari (statik.routes, statik.rev, perf.psi.key) bu dosyada silinmez:
-- statik anahtarlar kodun calismasi icin gerekli degildir (yoksa kayit varsayilanlari), PSI anahtari elle silinebilir.
drop table if exists public.perf_lab_runs;
notify pgrst, 'reload schema';
