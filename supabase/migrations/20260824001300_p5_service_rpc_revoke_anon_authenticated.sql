-- P5 (PANEL_KARAR_1 §4, U13 statik SQL kalıp testi bulgusu): yalnız service_role'e açık iki sayaç RPC'si.
--
-- NEDEN: 20260726000071 (increment_listing_view) ve 20260727000111 (increment_referral_click) EXECUTE'u yalnız
--   `from public` revoke edip service_role'e grant etti. Supabase'te public şemasındaki yeni fonksiyonlara varsayılan
--   ayrıcalıklarla anon/authenticated'a DOĞRUDAN EXECUTE verilir; `from public` bunu geri almaz. İkisi de SECURITY
--   DEFINER: anon/authenticated açık kalmışsa PostgREST `/rpc/` ile herhangi bir kiracının ilan görüntülenme
--   sayacını (listing_views, p_tenant_id parametreyle) veya tavsiye linki tıklanma sayacını keyfi şişirebilir.
--   Canlı DB'de gerçek durum `select has_function_privilege('anon', 'public.increment_listing_view(uuid,uuid)',
--   'execute')` ile salt-okunur doğrulanabilir; bu dosya her iki durumda da güvenle idempotenttir.
--
-- NE YAPAR: iki fonksiyonda EXECUTE public, anon, authenticated'dan revoke; service_role grant'i yeniden teyit.
-- KOD UYUMU (okundu): çağıranlar yalnız admin (service_role) istemcisi:
--   src/app/vitrin/[slug]/[id]/page.tsx (increment_listing_view), src/app/tavsiye/[token]/page.tsx
--   (increment_referral_click). Etkilenmez.
-- ETKİ: yalnız ayrıcalık DDL; veri ve fonksiyon gövdesi değişmez, kilit yok denecek kadar kısa.
-- GERİ ALMA: supabase/rollbacks/20260824001300_p5_service_rpc_revoke_anon_authenticated.rollback.sql
-- TASLAK: canlı DB'de çalıştırılmadı; yalnız statik denetlendi. Canlı uygulama restore edilebilir backup/PITR
--   doğrulandıktan sonra sahibi tarafından kontrollü `npm run db:migrate` ile yapılır.

revoke execute on function public.increment_listing_view(uuid, uuid) from public, anon, authenticated;
grant execute on function public.increment_listing_view(uuid, uuid) to service_role;

revoke execute on function public.increment_referral_click(uuid) from public, anon, authenticated;
grant execute on function public.increment_referral_click(uuid) to service_role;

notify pgrst, 'reload schema';
