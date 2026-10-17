-- GERI ALMA: 20261024030000_user_presence — ekip durumu tablosu, pasiflesme tetigi ve son yedekleme RPC'si duser.
-- Kod tablo/RPC yokken calismayi surdurur (durum secici "henuz etkin degil", ekip karti yalniz denetim kaydiyla,
-- "Son yedekleme" karosu cizilmez); kayitli durumlar KALICI olarak silinir.

set local lock_timeout = '5s';

drop function if exists public.office_last_backup();
drop trigger if exists trg_profiles_presence_clear on public.profiles;
drop function if exists public.user_presence_clear_inactive();
drop table if exists public.user_presence;
drop function if exists public.user_presence_stamp();
