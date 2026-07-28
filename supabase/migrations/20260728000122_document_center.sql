-- Belge Merkezi (/app/belgeler) — ofisin tüm dosyalarını tek ekranda toplayan
-- birleşik görünümün DB tarafı.
--
-- Neden gerekli:
--  1) `customer-files` storage bucket'ı HİÇBİR migration'da yaratılmamıştı.
--     `uploadCustomerFile` (src/app/actions/customer-files.ts) bu bucket'a
--     yazmaya çalışıyor; dev ortamında `storage.listBuckets()` yalnız
--     'property-media' ve 'agent-photos' döndürüyor. Yani müşteri belgesi
--     yükleme fiilen kırıktı. Bucket'ı burada, property-media ile birebir aynı
--     desende (private) yaratıyoruz.
--  2) PostgREST'te aggregate fonksiyonlar KAPALI ("Use of aggregate functions
--     is not allowed" — service role ile doğrulandı) ve `storage` şeması
--     PostgREST'e açık değil ("Invalid schema: storage"). Dolayısıyla depolama
--     kullanımı ne storage.objects'ten ne de `select file_size.sum()` ile
--     okunabiliyor. Tek sağlıklı yol: metadata kolonlarını (file_size) DB
--     içinde toplayan bir fonksiyon. Binlerce satırı uygulamaya taşıyıp orada
--     toplamaktan çok daha ucuz.
--  3) "Belgesiz müşteri" / "fotoğrafsız yayındaki portföy" / "eksik zorunlu
--     evrakı olan anlaşma" sayıları da NOT EXISTS ile DB'de hesaplanmalı;
--     uygulama katmanında id listesi çekip Set farkı almak N+1 ve kırpma
--     riski demek.
--
-- Güvenlik: her iki fonksiyon da SECURITY INVOKER (varsayılan) — yani
-- çağıranın RLS'i uygulanır, tenant izolasyonu tabloların kendi politikaları
-- üzerinden gelir. SECURITY DEFINER bilinçli olarak KULLANILMADI: definer
-- olsaydı tenant filtresini elle yazmak ve unutma riskini taşımak gerekirdi.

-- ---------------------------------------------------------------------------
-- 1) Eksik bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('customer-files', 'customer-files', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2) Belge Merkezi listesinin sıralama/tarih filtresi indeksleri
--    (mevcut indeksler customer_id / property_id önekli; belge merkezi
--     ofis genelinde created_at desc tarıyor)
-- ---------------------------------------------------------------------------
create index if not exists idx_customer_files_tenant_created
  on public.customer_files(tenant_id, created_at desc);

create index if not exists idx_property_media_tenant_created
  on public.property_media(tenant_id, created_at desc);

create index if not exists idx_deal_checklist_items_tenant_file
  on public.deal_checklist_items(tenant_id, created_at desc)
  where file_url is not null;

-- ---------------------------------------------------------------------------
-- 3) Depolama kullanımı — byte toplamı + dosya adedi
-- ---------------------------------------------------------------------------
create or replace function public.document_storage_usage()
returns table (
  customer_bytes bigint,
  customer_count bigint,
  media_bytes    bigint,
  media_count    bigint
)
language sql
stable
set search_path = public
as $$
  select
    coalesce((select sum(file_size) from public.customer_files), 0)::bigint,
    (select count(*) from public.customer_files)::bigint,
    coalesce((select sum(file_size) from public.property_media where storage_path is not null), 0)::bigint,
    (select count(*) from public.property_media where storage_path is not null)::bigint;
$$;

comment on function public.document_storage_usage() is
  'Belge Merkezi — depolama kullanımı (customer_files + property_media file_size toplamı). RLS ile tenant izole.';

-- ---------------------------------------------------------------------------
-- 4) Belge sağlığı sayaçları
-- ---------------------------------------------------------------------------
create or replace function public.document_health_counts()
returns table (
  customers_without_files        bigint,
  live_properties_without_photos bigint,
  deals_missing_docs             bigint,
  missing_required_items         bigint
)
language sql
stable
set search_path = public
as $$
  select
    (select count(*) from public.customers c
       where c.deleted_at is null
         and not exists (
           select 1 from public.customer_files f where f.customer_id = c.id
         ))::bigint,
    -- status kolonu hem İngilizce hem Türkçe değer taşıyabiliyor (portföy
    -- listesindeki matchesStatusFilter ile aynı ikili kabul).
    (select count(*) from public.properties p
       where p.deleted_at is null
         and p.status in ('live', 'Yayında')
         and not exists (
           select 1 from public.property_media m
            where m.property_id = p.id and m.kind = 'image'
         ))::bigint,
    (select count(distinct i.deal_id)
       from public.deal_checklist_items i
       join public.deals d on d.id = i.deal_id
      where i.is_required and not i.is_done
        and d.stage not in ('won', 'lost'))::bigint,
    (select count(*)
       from public.deal_checklist_items i
       join public.deals d on d.id = i.deal_id
      where i.is_required and not i.is_done
        and d.stage not in ('won', 'lost'))::bigint;
$$;

comment on function public.document_health_counts() is
  'Belge Merkezi — belgesiz müşteri, fotoğrafsız yayındaki portföy ve eksik zorunlu evraklı açık anlaşma sayıları. RLS ile tenant izole.';

grant execute on function public.document_storage_usage()  to authenticated, service_role;
grant execute on function public.document_health_counts()  to authenticated, service_role;
