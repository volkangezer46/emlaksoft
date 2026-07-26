-- `error_logs` tablosuna eksik GRANT'ler
--
-- ============================================================================
-- BULUNAN HATA
-- ============================================================================
-- Bir önceki migration tabloyu ve RLS politikalarını kurdu ama GRANT vermedi.
-- Sonuç: `service_role` tabloya YAZAMIYORDU.
--
--     code 42501 · permission denied for table error_logs
--
-- RLS ile tablo yetkisi AYRI iki katman. `service_role` RLS'i atlar ama
-- PostgreSQL'in kendi GRANT sistemine tabidir; INSERT yetkisi yoksa satır
-- yazamaz. Bu proje `20260721000003_grants.sql` içinde her tabloya elle
-- GRANT veriyor — yeni tabloda o adım atlandı.
--
-- NASIL YAKALANDI: Özelliği varsayımla değil DENEYEREK doğruladım. `logError`
-- hatayı bilinçli olarak yutuyor (asıl hatanın üstünü örtmemeli), bu yüzden
-- kayıt sessizce düşmüyordu. Doğrudan bir insert denemesi gerçek hatayı
-- gösterdi. Aynı sebeple `logError`a sınırlı bir uyarı mekanizması eklendi:
-- kalıcı bir yapılandırma hatası artık tamamen görünmez kalmıyor.
--
-- Diğer tablolarla aynı desen (bkz. 20260721000003_grants.sql).

grant all on public.error_logs to service_role;

-- `authenticated`: kiracı kendi hatalarını GÖREBİLİR (RLS politikası bunu
-- kendi kiracısıyla sınırlıyor). Yazma yolu yok — yazma yalnızca
-- service_role üzerinden, `lib/error-log.ts` içinden.
grant select on public.error_logs to authenticated;

-- Temizlik fonksiyonu security definer; yine de çağrı yetkisi açıkça verilsin.
grant execute on function public.purge_old_error_logs(integer) to service_role;
