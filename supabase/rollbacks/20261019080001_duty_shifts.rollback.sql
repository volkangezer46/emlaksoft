-- 20261019080001 geri alma: nobet cizelgesi tablosu ve koruma tetikleyicisi duser (cizelge silinir). Talep dagitimi
--   tablo yokken nobet adimini atlar; Nobet sekmesi "kurulum bekliyor" der.
set local lock_timeout = '5s';

drop table if exists public.duty_shifts;
drop function if exists public.guard_duty_shift_profile();
