-- Örnek veri onboarding'i — yeni ofis "sistemi örnek veriyle keşfet" akışı.
-- Araştırma bulgusu: dolu bir panel deneyimi aktivasyonu belirgin artırır; boş
-- dashboard yerine tek tıkla küçük gerçekçi bir Türkçe set yüklenir, tek tıkla
-- kalıcı temizlenir (bkz. src/app/actions/sample-data.ts).
--
-- tenants.sample_seeded_at : null = hiç yüklenmedi / temizlendi; dolu = örnek
--   veri şu an yüklü (dashboard'daki amber bilgi şeridi + Ayarlar kartı buna bakar).
-- is_sample                : örnek kayıt işareti — temizleme YALNIZ bu bayrağı
--   taşıyan satırları siler, gerçek kayıtlara asla dokunmaz. Hafif kolon,
--   index yok (temizleme nadir, tenant başına birkaç satır).
-- Not: deals'e kolon eklenmedi — tek örnek anlaşma, örnek müşteri/portföy
--   FK'ları üzerinden bulunup silinir (clearSampleData).

alter table public.tenants
  add column if not exists sample_seeded_at timestamptz;

alter table public.customers
  add column if not exists is_sample boolean not null default false;

alter table public.properties
  add column if not exists is_sample boolean not null default false;

alter table public.customer_demands
  add column if not exists is_sample boolean not null default false;

alter table public.tasks
  add column if not exists is_sample boolean not null default false;

alter table public.appointments
  add column if not exists is_sample boolean not null default false;
