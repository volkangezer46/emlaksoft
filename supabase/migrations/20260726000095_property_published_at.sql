-- properties.published_at — gerçek yayın zaman damgası
--
-- Neden:
--  * vitrin-eslesme cron'u "son 24 saatte yayına giren ilan" için updated_at
--    VEKİLİNİ kullanıyordu — fiyat düzeltmesi gibi alakasız update'ler de
--    "yeni yayın" sayılıp yanlış pozitif bildirim üretiyordu.
--  * Vitrin/portföy tarafında "Yeni" rozeti için dürüst bir kaynak gerekiyor.
--
-- Tasarım kararları:
--  * null = hiç yayına alınmamış (taslak vb.). Status 'live' YAPILDIĞINDA
--    uygulama katmanı İLK kez set eder; zaten doluysa DOKUNULMAZ — yeniden
--    yayına almada (reserved→live gibi) orijinal yayın tarihi korunur.
--  * Backfill: mevcut live kayıtlar için published_at = updated_at —
--    YAKLAŞIK ama dürüst bir başlangıç (gerçek yayın anı geriye dönük
--    bilinemez; updated_at eldeki en yakın tahmin). Yeni geçişler artık
--    gerçek anı yazar.

alter table public.properties
  add column if not exists published_at timestamptz;

comment on column public.properties.published_at is
  'İlk yayına alınma anı (status→live). Null = hiç yayınlanmadı; yeniden yayına almada korunur';

-- Mevcut yayındaki kayıtlar: updated_at yaklaşık başlangıç değeri olarak
update public.properties
   set published_at = updated_at
 where status = 'live'
   and published_at is null;

-- Cron filtresi (tenant_id + status='live' + published_at >= X) için indeks
create index if not exists idx_properties_published_at
  on public.properties(tenant_id, published_at desc)
  where status = 'live' and deleted_at is null;
