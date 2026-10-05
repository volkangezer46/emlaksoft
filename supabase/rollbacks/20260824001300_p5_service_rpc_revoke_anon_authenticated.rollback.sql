-- Rollback: 20260824001300_p5_service_rpc_revoke_anon_authenticated
-- UYARI: geri alma ÖNERİLMEZ; anon/authenticated'a sayaç şişirme kapısı açılır. Önceki durum Supabase varsayılan
-- ayrıcalıklarına bağlıydı (anon/authenticated EXECUTE büyük olasılıkla vardı). Zorunluysa aşağısı önceki etkin
-- hali taklit eder. service_role grant'i her iki halde de korunur.

grant execute on function public.increment_listing_view(uuid, uuid) to anon, authenticated;
grant execute on function public.increment_referral_click(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
