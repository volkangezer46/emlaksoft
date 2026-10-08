-- 20261008001400 geri alma: yalniz yeni salt-okunur fonksiyon kaldirilir (RPC yokken ilgili paneller "okunamadi" gosterir, uydurma sifir yok).
drop function if exists public.platform_dashboard_rollups(timestamptz, timestamptz, timestamptz, timestamptz, text[]);
notify pgrst, 'reload schema';
