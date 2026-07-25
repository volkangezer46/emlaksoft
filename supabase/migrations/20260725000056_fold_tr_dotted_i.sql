-- `fold_tr` düzeltmesi: büyük İ, `lower()` sonrası BİRLEŞEN NOKTA bırakıyordu
--
-- ============================================================================
-- HATA
-- ============================================================================
-- Bir önceki migration'da `fold_tr` şöyleydi:
--
--     translate(lower(v), 'ıİĞğ…', 'ii gg…')
--
-- Yani önce `lower()`, sonra `translate()`. PostgreSQL'in `lower('İ')` sonucu
-- tek bir `i` DEĞİL, `i` + U+0307 (birleşen üstteki nokta) oluyor. `translate`
-- sıraya geldiğinde ortada artık `İ` kalmadığı için hiçbir şey yapamıyor ve
-- geriye noktalı kalıntı kalıyor:
--
--     fold_tr('İstanbul')  ->  'i̇stanbul'   (beklenen: 'istanbul')
--     fold_tr('AYŞE DEMİR') -> 'ayse demi̇r'  (beklenen: 'ayse demir')
--
-- SONUCU: `find_duplicate_customers` içindeki AD sinyali çalışmıyordu.
-- "Ayşe Demir" ile "AYŞE DEMİR" eşleşmiyordu — tam da yakalaması gereken
-- durum. Canlı testte ortaya çıktı (telefon ve e-posta sinyalleri eşleşti,
-- ad sinyali sessizce boş döndü).
--
-- Bu, `src/lib/tr-text.ts` içinde belgelenen sorunun SQL karşılığı. Orada
-- önce Türkçe kurallarıyla küçültülüp sonra NFD + birleşen işaret temizliği
-- yapılıyor; burada da eşdeğeri gerekiyordu.
--
-- ============================================================================
-- DÜZELTME
-- ============================================================================
-- 1. `translate` ÖNCE çalışır: büyük İ/I daha `lower()` görmeden düz i olur.
-- 2. `lower()` kalan ASCII harfleri indirir.
-- 3. Güvenlik ağı: kalmış olabilecek U+0307 temizlenir (başka kaynaklardan
--    gelen metinlerde de olabilir).

create or replace function public.fold_tr(v text)
returns text
language sql
immutable
strict
as $$
  select btrim(
    regexp_replace(
      -- 3) artakalan birleşen nokta (U+0307)
      replace(
        -- 2) kalan harfleri küçült
        lower(
          -- 1) Türkçe harfleri ÖNCE düzleştir — lower() onları bozmadan
          translate(v, 'İIıĞğÜüŞşÖöÇçÂâÎîÛû', 'iiigguussooccaaiiuu')
        ),
        U&'\0307', ''
      ),
      '\s+', ' ', 'g'
    )
  );
$$;

comment on function public.fold_tr(text) is
  'Türkçe arama katlaması. src/lib/tr-text.ts foldTr ile eşdeğer. DİKKAT: translate() lower() ÖNCESİNDE olmalı, aksi hâlde büyük İ birleşen nokta bırakır (bkz. 20260725000056).';
