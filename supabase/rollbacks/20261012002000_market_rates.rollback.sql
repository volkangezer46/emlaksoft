-- 20261012002000 geri alma: piyasa oranlari tablosu duser (kod tablo yokken EVDS adimini ve varsayilani sessizce atlar).
drop table if exists public.market_rates;
notify pgrst, 'reload schema';
