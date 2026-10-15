-- Geri alma: 20261016040200_admin_search_members.sql
-- Yalniz salt-okunur arama fonksiyonu kaldirilir; veri degismez. Kod fonksiyon yokken uyeyi yalniz adla arar.
drop function if exists public.admin_search_members(text, integer);
notify pgrst, 'reload schema';
