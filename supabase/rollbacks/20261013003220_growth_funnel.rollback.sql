-- 20261013003220 geri alma: huni RPC'si düşer (Huni ve kanallar ekranı "veri okunamadı" boş durumuna düşer).
drop function if exists public.platform_growth_funnel(date, date);
notify pgrst, 'reload schema';
