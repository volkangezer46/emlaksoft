-- 20261012001720 geri alma: detay okuma RPC'leri düşer (kod fonksiyon yokken eski sorgulara döner).
drop function if exists public.deal_side_reads(uuid);
drop function if exists public.property_region_days(uuid);
notify pgrst, 'reload schema';
