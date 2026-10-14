-- Geri alma: 20261015021000_onboarding_snapshot_rpc.sql
-- Yalniz salt-okunur fonksiyon kaldirilir; veri degismez. Kod fonksiyon yokken eski ayri sayimlara duser.
drop function if exists public.onboarding_snapshot(uuid);
notify pgrst, 'reload schema';
