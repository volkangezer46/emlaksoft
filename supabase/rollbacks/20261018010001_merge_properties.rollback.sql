-- 20261018010001 geri alma: portföy birleştirme RPC'si düşer. /app/portfoyler/cift-kayit sayfası tarama ve veri sağlığını
--   göstermeye devam eder; "Birleştir" işlemi RPC yokken hata verir (hiçbir kayıt değişmez).
-- VERİ: yapılmış birleştirmeler GERİ ALINMAZ (taşınan kayıtlar ana portföyde, kopyalar soft-delete'li kalır; audit
--   'property.merge' kayıtları korunur).
set local lock_timeout = '5s';

drop function if exists public.merge_properties(uuid, uuid, uuid[], jsonb);
