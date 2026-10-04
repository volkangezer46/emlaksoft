-- Faz 3 / 03: danışman uzmanlıkları ve uzmanlık bölgeleri.
--
-- advisor_specialties: danışman × uzmanlık (kind='property_type' -> definitions.property_type değeri; kind='segment' ->
--   definitions 'advisor_segment' değeri, ör. Lüks konut/Yatırımlık/Proje) × işlem türü (Satılık/Kiralık, null = ikisi)
--   × fiyat bandı (TL) × deneyim. LİSTE KODA SABİT YAZILMAZ: value, ofisin tanımlarından gelir (definitions);
--   FK kurulmaz (definitions tenant/global ayrımlı ve serbest metin değerli), uygulama doğrular.
-- advisor_regions: danışman × il/ilçe/mahalle × ağırlık (1 düşük .. 5 ana bölge). Mahalle seçilirse ilçe zorunlu.
-- Yeni tanım kategorisi 'advisor_segment': global varsayılanlar aşağıda seed edilir (tenant_id null). definitions.category
--   serbest metindir (20260813000300); kod tarafında DEFINITION_CATEGORIES'e eklenmesi P-UZMAN paketinin işidir.
-- RLS: tenant içi herkes okur (düşük hassasiyet: "kim hangi bölgeyi biliyor" ekip vitrinidir); yazma owner/gm.
-- GERİ ALMA: rollbacks/20260816001400_advisor_specialties_regions.rollback.sql.
-- RİSK: düşük. BAĞIMLILIK: 20260816000200 (faz2_touch_updated_at), 20260816001300 (advisor_profiles gerekmez, profiles yeter).

create table if not exists public.advisor_specialties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_id uuid not null,
  kind text not null check (kind in ('property_type', 'segment')),
  value text not null check (char_length(btrim(value)) between 1 and 64),
  transaction_type text check (transaction_type is null or transaction_type in ('Satılık', 'Kiralık')),
  price_min numeric check (price_min is null or price_min >= 0),
  price_max numeric check (price_max is null or price_max >= 0),
  experience_years smallint check (experience_years is null or experience_years between 0 and 60),
  level smallint not null default 2 check (level between 1 and 3), -- 1 yeni, 2 deneyimli, 3 uzman
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint advisor_specialties_price_order check (price_min is null or price_max is null or price_min <= price_max),
  constraint advisor_specialties_profile_tenant_fkey
    foreign key (profile_id, tenant_id) references public.profiles (id, tenant_id) on delete cascade
);
create unique index if not exists uq_advisor_specialties_key
  on public.advisor_specialties (profile_id, kind, value, coalesce(transaction_type, ''));
create index if not exists idx_advisor_specialties_lookup
  on public.advisor_specialties (tenant_id, kind, value);

create table if not exists public.advisor_regions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_id uuid not null,
  province_id uuid not null references public.geo_provinces(id),
  district_id uuid references public.geo_districts(id),
  neighborhood_id uuid references public.geo_neighborhoods(id),
  weight smallint not null default 3 check (weight between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint advisor_regions_hierarchy check (neighborhood_id is null or district_id is not null),
  constraint advisor_regions_profile_tenant_fkey
    foreign key (profile_id, tenant_id) references public.profiles (id, tenant_id) on delete cascade
);
create unique index if not exists uq_advisor_regions_key
  on public.advisor_regions (
    profile_id, province_id,
    coalesce(district_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(neighborhood_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
create index if not exists idx_advisor_regions_lookup
  on public.advisor_regions (tenant_id, province_id, district_id, neighborhood_id);

drop trigger if exists trg_advisor_specialties_touch on public.advisor_specialties;
create trigger trg_advisor_specialties_touch before update on public.advisor_specialties
for each row execute function public.faz2_touch_updated_at();
drop trigger if exists trg_advisor_regions_touch on public.advisor_regions;
create trigger trg_advisor_regions_touch before update on public.advisor_regions
for each row execute function public.faz2_touch_updated_at();

alter table public.advisor_specialties enable row level security;
alter table public.advisor_regions enable row level security;

create policy advisor_specialties_select on public.advisor_specialties for select to authenticated
using (tenant_id = (select public.current_tenant_id()));
create policy advisor_specialties_insert on public.advisor_specialties for insert to authenticated
with check (tenant_id = (select public.current_tenant_id()) and (select public.current_profile_role()) in ('owner', 'gm'));
create policy advisor_specialties_update on public.advisor_specialties for update to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.current_profile_role()) in ('owner', 'gm'))
with check (tenant_id = (select public.current_tenant_id()) and (select public.current_profile_role()) in ('owner', 'gm'));
create policy advisor_specialties_delete on public.advisor_specialties for delete to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.current_profile_role()) in ('owner', 'gm'));

create policy advisor_regions_select on public.advisor_regions for select to authenticated
using (tenant_id = (select public.current_tenant_id()));
create policy advisor_regions_insert on public.advisor_regions for insert to authenticated
with check (tenant_id = (select public.current_tenant_id()) and (select public.current_profile_role()) in ('owner', 'gm'));
create policy advisor_regions_update on public.advisor_regions for update to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.current_profile_role()) in ('owner', 'gm'))
with check (tenant_id = (select public.current_tenant_id()) and (select public.current_profile_role()) in ('owner', 'gm'));
create policy advisor_regions_delete on public.advisor_regions for delete to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.current_profile_role()) in ('owner', 'gm'));

revoke all on table public.advisor_specialties from public, anon;
revoke all on table public.advisor_regions from public, anon;
grant select, insert, update, delete on table public.advisor_specialties to authenticated;
grant select, insert, update, delete on table public.advisor_regions to authenticated;
grant all on table public.advisor_specialties to service_role;
grant all on table public.advisor_regions to service_role;

-- Global varsayılan segmentler (ofis kendi satırlarıyla ekler/gizler; kodda sabit liste yoktur).
insert into public.definitions (tenant_id, category, value, label, sort_order) values
  (null, 'advisor_segment', 'Lüks konut', 'Lüks konut', 1),
  (null, 'advisor_segment', 'Yatırımlık', 'Yatırımlık', 2),
  (null, 'advisor_segment', 'Yeni proje', 'Yeni proje', 3),
  (null, 'advisor_segment', 'Kentsel dönüşüm', 'Kentsel dönüşüm', 4),
  (null, 'advisor_segment', 'Tarım arazisi', 'Tarım arazisi', 5),
  (null, 'advisor_segment', 'Sanayi / lojistik', 'Sanayi / lojistik', 6),
  (null, 'advisor_segment', 'Yabancıya satış', 'Yabancıya satış', 7)
on conflict do nothing;
