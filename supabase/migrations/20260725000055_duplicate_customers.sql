-- Çift müşteri kaydı tespiti (X6)
--
-- ============================================================================
-- NEDEN GEREKLİ
-- ============================================================================
-- `customers` tablosunda telefon/e-posta üzerinde HİÇBİR benzersizlik kısıtı
-- yok. Çok danışmanlı bir ofiste aynı kişinin iki kez girilmesi olağan:
-- biri portal lead'inden, biri elle. Sonuçları:
--
--   · aynı kişi iki danışman tarafından ARANIR (müşteri açısından rahatsız
--     edici, KVKK açısından da savunması zor)
--   · lead kaynağı ve dönüşüm istatistikleri bölünür
--   · görüşme geçmişi ikiye ayrılır, kimse tam resmi göremez
--   · İYS izni bir kayıtta var diğerinde yok olabilir
--
-- ============================================================================
-- BU MIGRATION NE YAPMIYOR
-- ============================================================================
-- BİRLEŞTİRME YAPMIYOR. Yalnızca aday grupları buluyor. Birleştirme, alt
-- kayıtları (talep, randevu, çağrı, görüşme, anlaşma, teklif, sözleşme,
-- görev) taşımayı gerektiren geri alınamaz bir işlem; kullanıcının hangi
-- kaydın kalacağına bakarak karar vermesi gerekiyor. Otomatik birleştirme
-- yanlış eşleşmede veri kaybı demek — bilinçli olarak yapılmadı.

-- Türkçe metin katlama: src/lib/tr-text.ts `foldTr` ile aynı davranış.
-- İki tarafın da aynı sonucu üretmesi şart, yoksa arayüzde eşleşen iki kayıt
-- burada eşleşmez.
create or replace function public.fold_tr(v text)
returns text
language sql
immutable
strict
as $$
  select regexp_replace(
    translate(lower(v), 'ıİĞğÜüŞşÖöÇçÂâÎîÛû', 'iigguussooccaaiiuu'),
    '\s+', ' ', 'g'
  );
$$;

comment on function public.fold_tr(text) is
  'Türkçe arama katlaması. src/lib/tr-text.ts foldTr ile eşdeğer olmalı.';

-- ============================================================================
-- Çift kayıt adayları
-- ============================================================================
-- Üç sinyal, güçlüden zayıfa:
--   phone  → normalize telefon aynı (yazarken normalize ediliyor) — neredeyse kesin
--   email  → e-posta aynı — neredeyse kesin
--   name   → katlanmış ad soyad aynı — OLASI, tek başına kanıt değil
--            ("Ali Yılmaz" iki farklı kişi olabilir)
create or replace function public.find_duplicate_customers(p_tenant_id uuid)
returns table (
  signal       text,
  match_key    text,
  customer_id  uuid,
  full_name    text,
  phone        text,
  email        text,
  created_at   timestamptz,
  assigned_to  uuid,
  activity     integer
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with base as (
    select c.id, c.full_name, c.phone, c.email, c.created_at, c.assigned_to
    from public.customers c
    where c.tenant_id = p_tenant_id
      and c.deleted_at is null
  ),
  -- Hangi kaydın "daha dolu" olduğunu kullanıcı görebilsin: birleştirmede
  -- genelde aktivitesi çok olan tutulur.
  activity as (
    select b.id,
      (select count(*) from public.customer_demands d where d.customer_id = b.id)
      + (select count(*) from public.appointments a where a.customer_id = b.id)
      + (select count(*) from public.calls   ca where ca.customer_id = b.id)
      + (select count(*) from public.communications co where co.customer_id = b.id)
      + (select count(*) from public.deals   de where de.customer_id = b.id)
      as n
    from base b
  ),
  -- Her sinyal için: aynı anahtarı paylaşan BİRDEN FAZLA kayıt var mı?
  keyed as (
    select 'phone'::text as signal, b.phone as match_key, b.id
    from base b where nullif(btrim(b.phone), '') is not null
    union all
    select 'email', fold_tr(b.email), b.id
    from base b where nullif(btrim(b.email), '') is not null
    union all
    select 'name', fold_tr(b.full_name), b.id
    from base b where nullif(btrim(b.full_name), '') is not null
  ),
  gruplu as (
    select k.signal, k.match_key
    from keyed k
    group by k.signal, k.match_key
    having count(*) > 1
  )
  select
    g.signal,
    g.match_key,
    b.id            as customer_id,
    b.full_name,
    b.phone,
    b.email,
    b.created_at,
    b.assigned_to,
    coalesce(a.n, 0)::int as activity
  from gruplu g
  join keyed k on k.signal = g.signal and k.match_key = g.match_key
  join base  b on b.id = k.id
  left join activity a on a.id = b.id
  -- Güçlü sinyal önce; grup içinde en eski kayıt üstte (genelde korunacak olan).
  order by
    case g.signal when 'phone' then 0 when 'email' then 1 else 2 end,
    g.match_key,
    b.created_at;
$$;

comment on function public.find_duplicate_customers(uuid) is
  'Çift müşteri kaydı adayları. Birleştirme YAPMAZ — yalnızca aday grupları döner.';
