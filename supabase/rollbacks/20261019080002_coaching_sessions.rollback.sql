-- 20261019080002 geri alma: birebir gorusme tablolari, tetikleyici ve okuma yuklemi duser (notlar ve taahhutler
--   silinir; taahhutten acilan gorevler gorevler listesinde kalir). Kod tablolar yokken Birebir sekmesinde
--   "kurulum bekliyor" der.
set local lock_timeout = '5s';

drop table if exists public.coaching_commitments;
drop table if exists public.coaching_sessions;
drop function if exists public.guard_coaching_commitment_update();
drop function if exists public.coaching_can_view(uuid, uuid);
