-- Geri alma: 20261015020000_advisor_counts_rpc.sql
-- Yalniz salt-okunur sayim fonksiyonu kaldirilir; veri degismez. Kod fonksiyon yokken eski tek-tarama sayimina duser.
drop function if exists public.advisor_counts(uuid[], uuid, boolean, text[]);
notify pgrst, 'reload schema';
