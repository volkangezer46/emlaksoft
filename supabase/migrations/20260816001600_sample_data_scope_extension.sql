-- Faz 3 / 05: demo (örnek) veri kapsamını genişlet — yalnız is_sample bayrağı ve demo paketi bilgisi.
--
-- MEVCUT (20260726000086/096): customers, properties, customer_demands, tasks, appointments, deals zaten is_sample taşır.
-- EKSİK (tam demo ofis için): commissions, offers, contracts, rentals, calls, expenses, notifications ve DEMO DANIŞMAN
-- profilleri (profiles). Her biri nullable-olmayan sabit varsayılanlı boolean; mevcut satırlar false kalır.
-- tenants.sample_pack: hangi demo paketi yüklendi (konut | ticari | arsa); null = yüklü değil.
-- tenants.sample_cleared_at: "Gerçek kullanıma başla" ile temizlendiği an (denetim ve tekrar yükleme kapısı).
-- Temizleme mantığı KODDA (FK sırası + bağlı gerçek kayıt atlama + onay), burada değil; bu dosya yalnız sütun ekler.
-- Kısmi indeks: yalnız is_sample=true satırlar (tenant başına birkaç yüz) — temizleme ve banner sayacı hızlı, diğer
--   sorgulara maliyet yok.
-- GERİ ALMA: rollbacks/20260816001600_sample_data_scope_extension.rollback.sql.
-- RİSK: düşük (ADD COLUMN sabit varsayılan, tablo yeniden yazımı yok). profiles/commissions sıcak tablolardır; yine de
--   metadata-only değişikliktir.

alter table public.commissions   add column if not exists is_sample boolean not null default false;
alter table public.offers        add column if not exists is_sample boolean not null default false;
alter table public.contracts     add column if not exists is_sample boolean not null default false;
alter table public.rentals       add column if not exists is_sample boolean not null default false;
alter table public.calls         add column if not exists is_sample boolean not null default false;
alter table public.expenses      add column if not exists is_sample boolean not null default false;
alter table public.notifications add column if not exists is_sample boolean not null default false;
alter table public.profiles      add column if not exists is_sample boolean not null default false;

alter table public.tenants
  add column if not exists sample_pack text check (sample_pack is null or sample_pack in ('konut', 'ticari', 'arsa')),
  add column if not exists sample_cleared_at timestamptz;

create index if not exists idx_commissions_sample on public.commissions (tenant_id) where is_sample;
create index if not exists idx_offers_sample on public.offers (tenant_id) where is_sample;
create index if not exists idx_contracts_sample on public.contracts (tenant_id) where is_sample;
create index if not exists idx_rentals_sample on public.rentals (tenant_id) where is_sample;
create index if not exists idx_profiles_sample on public.profiles (tenant_id) where is_sample;
create index if not exists idx_customers_sample on public.customers (tenant_id) where is_sample;
create index if not exists idx_properties_sample on public.properties (tenant_id) where is_sample;

comment on column public.profiles.is_sample is 'Demo danışman (giriş yapılamaz, geçersiz alan adlı e-posta); Gerçek kullanıma başla ile silinir.';
comment on column public.tenants.sample_pack is 'Yüklenen demo paketi: konut | ticari | arsa.';
