-- 001500 (deal_process_steps) ve 001800 (listing_analyses) tablo yetkisi yazmadi:
-- authenticated yalniz SELECT, service_role yazamiyor. Sonuc: tapu sureci adimi
-- kaydedilemiyor, musteri portali "Tapu surecim" okuyamiyor, ilan analizi yazilamiyor.
-- RLS politikalari degismez; yalniz politikalarla uyumlu tablo yetkileri verilir.

revoke all on public.deal_process_steps from public, anon, authenticated;
revoke all on public.listing_analyses from public, anon, authenticated;

grant select, insert, update, delete on public.deal_process_steps to authenticated;
grant select, insert on public.listing_analyses to authenticated;

grant select, insert, update, delete on public.deal_process_steps to service_role;
grant select, insert, update, delete on public.listing_analyses to service_role;

notify pgrst, 'reload schema';
