-- Vitrin analitiği: ilan görüntülenme sayacı + ziyaretçi kayıtlı aramaları
--
-- ============================================================================
-- NEDEN
-- ============================================================================
-- 1) listing_views: /vitrin/[slug]/[id] herkese açık ilan sayfasının günlük
--    görüntülenme sayacı. Satır anahtarı (tenant, property, gün) — her render
--    atomik upsert ile sayacı 1 artırır (increment_listing_view RPC).
--    NOT: Vitrin ISR ile 120 sn CDN önbellekli; sayaç yalnızca yeniden
--    doğrulama render'larında artar → YAKLAŞIK sayımdır (trend göstergesi).
-- 2) vitrin_saved_searches: vitrin ziyaretçisinin "Aramamı kaydet" kutusuyla
--    bıraktığı kriter + telefon. Cron (/api/cron/vitrin-eslesme) son 24 saatte
--    yayına giren ilanları bu kriterlerle eşleştirip TENANT'a bildirim yazar
--    (ziyaretçiye SMS gönderilmez — maliyet).
--
-- Yazma yalnızca service_role üzerinden (public sayfalar + cron admin client
-- kullanır). Tenant kullanıcıları kendi satırlarını okuyabilir (RLS select).

-- ----------------------------------------------------------------------------
-- Günlük ilan görüntülenme sayacı
-- ----------------------------------------------------------------------------
create table if not exists public.listing_views (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  day         date not null default current_date,
  count       integer not null default 0,
  unique (tenant_id, property_id, day)
);

create index if not exists idx_listing_views_tenant_day
  on public.listing_views(tenant_id, day desc);
create index if not exists idx_listing_views_property
  on public.listing_views(property_id, day desc);

alter table public.listing_views enable row level security;

-- Tenant kullanıcıları yalnızca kendi ofislerinin sayaçlarını okur.
drop policy if exists listing_views_tenant_read on public.listing_views;
create policy listing_views_tenant_read on public.listing_views
  for select
  using (tenant_id = public.current_tenant_id());

grant select on public.listing_views to authenticated;
grant all on public.listing_views to service_role;

comment on table public.listing_views is
  'Vitrin ilan sayfasi gunluk goruntulenme sayaci (ISR nedeniyle yaklasik).';

-- Atomik günlük artırma: satır yoksa 1 ile açar, varsa +1.
create or replace function public.increment_listing_view(p_tenant_id uuid, p_property_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.listing_views (tenant_id, property_id, day, count)
  values (p_tenant_id, p_property_id, current_date, 1)
  on conflict (tenant_id, property_id, day)
  do update set count = public.listing_views.count + 1;
$$;

-- Yalnızca service_role çağırır (public sayfa admin client kullanır);
-- authenticated'a açılmaz — istemciden keyfî sayaç şişirme kapısı olmasın.
revoke execute on function public.increment_listing_view(uuid, uuid) from public;
grant execute on function public.increment_listing_view(uuid, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- Ziyaretçi kayıtlı aramaları
-- ----------------------------------------------------------------------------
create table if not exists public.vitrin_saved_searches (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  -- Ziyaretçi adı (opsiyonel — form zorlamaz)
  name             text,
  -- 05XXXXXXXXX normalize edilmiş cep telefonu (lib/phone standardı)
  phone            text not null,
  tx_type          text not null check (tx_type in ('satilik','kiralik')),
  province_id      uuid not null references public.geo_provinces(id),
  district_id      uuid references public.geo_districts(id),
  min_price        numeric,
  max_price        numeric,
  rooms            text,
  -- KVKK onay anı — form onay kutusu işaretlenmeden kayıt oluşmaz
  kvkk_at          timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  -- Cron en son ne zaman bu arama için tenant'a bildirim yazdı (24s spam freni)
  last_notified_at timestamptz
);

create index if not exists idx_vitrin_saved_searches_tenant
  on public.vitrin_saved_searches(tenant_id, created_at desc);

alter table public.vitrin_saved_searches enable row level security;

drop policy if exists vitrin_saved_searches_tenant_read on public.vitrin_saved_searches;
create policy vitrin_saved_searches_tenant_read on public.vitrin_saved_searches
  for select
  using (tenant_id = public.current_tenant_id());

grant select on public.vitrin_saved_searches to authenticated;
grant all on public.vitrin_saved_searches to service_role;

comment on table public.vitrin_saved_searches is
  'Vitrin ziyaretcisinin biraktigi kayitli arama (KVKK onayli; cron eslestirir).';
