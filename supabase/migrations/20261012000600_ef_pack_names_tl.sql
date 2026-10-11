-- Analiz paketi adları: "... kontör" -> "... TL" (yalnız DOKUNULMAMIŞ seed adları).
--
-- KARAR (2026-10-12): kullanıcıya görünen dilde "kontör" kalkar; bakiye "analiz bakiyesi", birim TL'dir (1 birim = 1 TL).
--   Veri modeli, birimler ve ef_credit_* iç adları DEĞİŞMEZ. Arayüz paket adını zaten units/months alanlarından üretir; bu dosya
--   yalnız platform_settings 'ef.packs' içindeki varsayılan (seed) paket adlarını yeni dile çevirir.
-- KAPSAM: yalnız  "<N> aylık · aylık 1.000 kontör"  desenindeki adlar; admin'in elle yazdığı başka adlara DOKUNULMAZ. Fiyat, units,
--   months, aktiflik, sıra aynen kalır. Ayar yoksa/boşsa hiçbir şey yapılmaz (TS varsayılanı zaten TL adlıdır).
-- GERİ ALMA: supabase/rollbacks/20261012000600_ef_pack_names_tl.rollback.sql
-- BAĞIMLILIK: 20261008001000 (ef.packs seed). RİSK: çok düşük (tek ayar satırı, metin adı).

set local lock_timeout = '5s';

update public.platform_settings
   set value = pg_catalog.regexp_replace(value, '(aylık [0-9.]+) kontör"', '\1 TL"', 'g'),
       updated_at = pg_catalog.now()
 where key = 'ef.packs'
   and value ~ 'aylık [0-9.]+ kontör"';

-- DOGRULAMA (salt-okunur): select value from public.platform_settings where key = 'ef.packs';  -- "kontör" geçmemeli
