-- Ofisler Arası Ağ v1 (MLS temeli) — network_listings + network_requests
--
-- Neden:
--  * Ofisler portföylerini başka ofislerin taleplerine açmak istiyor
--    (komisyon paylaşımlı iş birliği). Bu, kiracılar-arası veri paylaşımı
--    demek — TEMKİNLİ mimari: paylaşım yalnız AÇIK OPT-IN (network_listings
--    satırı), havuzun çapraz okuması RLS ile DEĞİL service role action ile
--    ve MASKELİ DTO üzerinden (malik/iletişim/adres asla; konum ilçe düzeyi).
--
-- Tasarım kararları:
--  * RLS GEVŞETİLMEDİ: network_listings'i her tenant yalnız kendi satırları
--    için görür/yönetir. Diğer ofislerin aktif kayıtlarını okuyan tek yol
--    `listNetworkPool` server action'ıdır (service_role + maskeleme kodda).
--  * network_requests iki taraflı: from tarafı oluşturur + geri çeker
--    (withdraw), to tarafı yanıtlar (accept/reject). UPDATE iki ayrı
--    politikaya bölündü; her biri kendi tarafının yalnız izinli durum
--    geçişini yazabilsin diye WITH CHECK durum kümesini de kilitler.
--  * unique(property_id): bir portföy ağda tek kayıt olabilir (paused dahil);
--    tekrar paylaşım mevcut kaydı günceller, kopya üretmez.
--  * commission_share_pct 0-50 aralığı: %50 üstü paylaşım gerçekçi değil,
--    yazım hatasını DB kessin.

-- ============================================================
-- network_listings — ağa açılan portföyler (opt-in kaydı)
-- ============================================================
create table if not exists public.network_listings (
  id                   uuid        primary key default gen_random_uuid(),
  tenant_id            uuid        not null references public.tenants(id)    on delete cascade,
  property_id          uuid        not null references public.properties(id) on delete cascade,
  commission_share_pct numeric(5,2) not null
                                   check (commission_share_pct >= 0 and commission_share_pct <= 50),
  note                 text,
  status               text        not null default 'active'
                                   check (status in ('active', 'paused')),
  created_by           uuid        references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  unique (property_id)
);

comment on table  public.network_listings is
  'Ofisler arası ağ (MLS) opt-in kayıtları — çapraz okuma yalnız service role action ile, maskeli';
comment on column public.network_listings.commission_share_pct is
  'Karşı ofise önerilen komisyon paylaşım yüzdesi (0-50)';

create index if not exists idx_network_listings_tenant
  on public.network_listings (tenant_id, status, created_at desc);

create index if not exists idx_network_listings_status
  on public.network_listings (status, created_at desc);

-- ============================================================
-- network_requests — iş birliği talepleri (iki taraflı)
-- ============================================================
create table if not exists public.network_requests (
  id             uuid        primary key default gen_random_uuid(),
  listing_id     uuid        not null references public.network_listings(id) on delete cascade,
  from_tenant_id uuid        not null references public.tenants(id) on delete cascade,
  to_tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  message        text,
  status         text        not null default 'pending'
                             check (status in ('pending', 'accepted', 'rejected', 'withdrawn')),
  responded_at   timestamptz,
  created_by     uuid        references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  check (from_tenant_id <> to_tenant_id)
);

comment on table  public.network_requests is
  'Ağ iş birliği talepleri — from tarafı oluşturur/geri çeker, to tarafı yanıtlar';
comment on column public.network_requests.status is
  'pending: bekliyor | accepted: kabul (iletişim açılır) | rejected: ret | withdrawn: geri çekildi';

create index if not exists idx_network_requests_listing
  on public.network_requests (listing_id, status);

create index if not exists idx_network_requests_from
  on public.network_requests (from_tenant_id, created_at desc);

create index if not exists idx_network_requests_to
  on public.network_requests (to_tenant_id, status, created_at desc);

-- ============================================================
-- RLS — ağ havuzunun çapraz okuması BURADA DEĞİL (service role action'da)
-- ============================================================
alter table public.network_listings enable row level security;
alter table public.network_requests enable row level security;

drop policy if exists network_listings_tenant        on public.network_listings;
drop policy if exists network_listings_tenant_insert on public.network_listings;
drop policy if exists network_requests_select        on public.network_requests;
drop policy if exists network_requests_insert        on public.network_requests;
drop policy if exists network_requests_respond       on public.network_requests;
drop policy if exists network_requests_withdraw      on public.network_requests;

-- Tenant kendi ağ kayıtlarını yönetir; başka ofisin kaydı bu politikadan GÖRÜNMEZ.
create policy network_listings_tenant on public.network_listings
  using (tenant_id = public.current_tenant_id());

create policy network_listings_tenant_insert on public.network_listings for insert
  with check (tenant_id = public.current_tenant_id());

-- Her iki taraf yalnız KENDİ tarafında olduğu talepleri okur.
create policy network_requests_select on public.network_requests for select
  using (
    from_tenant_id = public.current_tenant_id()
    or to_tenant_id = public.current_tenant_id()
  );

-- Talebi yalnız from tarafı kendi adına açabilir (to alanına kendini yazamaz — tablo check'i).
create policy network_requests_insert on public.network_requests for insert
  with check (from_tenant_id = public.current_tenant_id());

-- Yanıt: yalnız to tarafı, yalnız bekleyen talebi, yalnız accepted/rejected'a çevirebilir.
-- WITH CHECK yeni satırı sınar: taraf kolonları değiştirilemez (to hâlâ ben olmalı)
-- ve durum yalnız yanıt kümesine gidebilir.
create policy network_requests_respond on public.network_requests for update
  using (
    to_tenant_id = public.current_tenant_id()
    and status = 'pending'
  )
  with check (
    to_tenant_id = public.current_tenant_id()
    and status in ('accepted', 'rejected')
  );

-- Geri çekme: yalnız from tarafı, yalnız bekleyen talebi, yalnız withdrawn'a çevirebilir.
create policy network_requests_withdraw on public.network_requests for update
  using (
    from_tenant_id = public.current_tenant_id()
    and status = 'pending'
  )
  with check (
    from_tenant_id = public.current_tenant_id()
    and status = 'withdrawn'
  );

grant all on public.network_listings to authenticated, service_role;
grant all on public.network_requests to authenticated, service_role;

-- ============================================================
-- permission_defaults — 'network' modülü seed'i
-- (src/lib/permissions.ts matrisiyle birebir: owner/gm ALL,
--  branch_manager view-create-edit, advisor view)
-- ============================================================
insert into public.permission_defaults (role, module, action)
select r, 'network', a
from (values ('owner'), ('gm')) as roles(r)
cross join (values ('view'), ('create'), ('edit'), ('delete')) as acts(a)
on conflict do nothing;

insert into public.permission_defaults (role, module, action)
select 'branch_manager', 'network', a
from (values ('view'), ('create'), ('edit')) as acts(a)
on conflict do nothing;

insert into public.permission_defaults (role, module, action)
values ('advisor', 'network', 'view')
on conflict do nothing;
