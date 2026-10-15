-- SK9 / B093 — SALT OKUNUR düzeltme listesi: hatalı ayraçla kaydedilmiş m² ve aidat değerleri.
-- Eski sunucu ayrıştırıcısı "1.250" → 1.25 ve "" → 0 yazıyordu; portal ek alanı aidat "1.500" → 1.5 oluyordu.
-- Bu dosya VERİ DEĞİŞTİRMEZ (yalnız SELECT). Düzeltme ofisin kendisi tarafından portföy düzenleme penceresinden yapılır;
-- kayıt (updateProperty) yeni ayrıştırıcıyla (parseTrDecimal) yazar ve price_health'i o anda yeniden hesaplar.
--
-- Çalıştırma (sahibin/ana oturumun adımı; salt okunur):
--   docker exec -i supabase-db-<id> psql -U postgres -d postgres -At -F '|' < scripts/sql/sk9-sqm-dues-report.sql
--
-- Sütunlar: ofis | portföy kodu | başlık | tür | durum | m² | aidat | fiyat sağlığı | neden

select
  t.slug as ofis,
  p.property_code as kod,
  left(coalesce(p.title, ''), 60) as baslik,
  p.property_type as tur,
  p.status as durum,
  p.features ->> 'sqm' as m2,
  p.features ->> 'dues' as aidat,
  p.price_health as fiyat_sagligi,
  concat_ws(', ',
    case when (p.features ->> 'sqm') ~ '^-?[0-9.]+$' and (p.features ->> 'sqm')::numeric < 10
          and p.property_type in ('Daire', 'Villa', 'Müstakil ev', 'Rezidans', 'Yazlık', 'Köşk', 'Konut')
      then 'konut m² < 10' end,
    case when (p.features ->> 'sqm') ~ '^-?[0-9.]+$' and (p.features ->> 'sqm')::numeric = 0 then 'm² = 0 (boş alan 0 yazılmış)' end,
    case when (p.features ->> 'dues') ~ '^-?[0-9.]+$' and (p.features ->> 'dues')::numeric > 0
          and (p.features ->> 'dues')::numeric < 10 then 'aidat < 10 (binlik ayraç ondalık okunmuş)' end
  ) as neden
from public.properties p
join public.tenants t on t.id = p.tenant_id
where p.deleted_at is null
  and (
    ((p.features ->> 'sqm') ~ '^-?[0-9.]+$' and (p.features ->> 'sqm')::numeric < 10
      and (p.property_type in ('Daire', 'Villa', 'Müstakil ev', 'Rezidans', 'Yazlık', 'Köşk', 'Konut')
           or (p.features ->> 'sqm')::numeric = 0))
    or ((p.features ->> 'dues') ~ '^-?[0-9.]+$' and (p.features ->> 'dues')::numeric > 0 and (p.features ->> 'dues')::numeric < 10)
  )
order by t.slug, p.property_code;
