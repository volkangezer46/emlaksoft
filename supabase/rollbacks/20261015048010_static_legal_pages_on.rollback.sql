-- 20261015048010 geri alma: migration'ın yazdığı `statik.routes` satırı, DEĞİŞTİRİLMEMİŞSE silinir (yasal sayfalar
-- kayıt defteri varsayılanına, yani normal Next sunumuna döner). Sahip Hız ekranından anahtarı değiştirdiyse satır
-- onun kararıdır ve korunur. Idempotent.

set local lock_timeout = '5s';

delete from public.platform_settings
where key = 'statik.routes'
  and value = '{"gizlilik":true,"kvkk-aydinlatma":true,"kullanim-sartlari":true,"cerez-politikasi":true,"mesafeli-satis":true,"on-bilgilendirme":true,"iptal-iade":true,"davet-kosullari":true}';
