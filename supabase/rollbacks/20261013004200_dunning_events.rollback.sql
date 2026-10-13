-- 20261013004200 geri alma: tahsilat (dunning) olay gunlugu duser. Kod tablo yokken yalniz uygulama ici kademe bildirimi
-- gonderir (bugunku davranis), e-posta/SMS kademeleri atlanir, rapor ve Ofis 360 "gunluk yok" gosterir.
-- platform_settings dunning.* anahtarlari bu dosyada silinmez (yoksa kayit varsayilanlari = bugunku davranis).
drop table if exists public.dunning_events;
notify pgrst, 'reload schema';
