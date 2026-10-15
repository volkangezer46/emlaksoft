-- Geri alma: 20261016110300_branch_rollup_rpc.sql
-- Yalniz salt-okunur rollup fonksiyonu kaldirilir; veri degismez. Kod fonksiyon yokken eski sayfali taramaya duser.
drop function if exists public.branch_rollup(timestamptz, timestamptz);
notify pgrst, 'reload schema';
