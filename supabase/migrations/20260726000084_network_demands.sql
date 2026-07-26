-- Ofisler Arası Ağ v1.1 — TALEP HAVUZU (network_demands + network_demand_responses)
--
-- Neden:
--  * Vizyondaki 'portföy + talep havuzu'nun ikinci yarısı: ofisler AÇIK alıcı
--    taleplerini (customer_demands) diğer ofislere komisyon paylaşımıyla açar;
--    karşı ofis "bende uygun portföy var" yanıtı gönderir.
--
-- Tasarım kararları (20260726000079_network_module.sql ile birebir ilke):
--  * MÜŞTERİ BİLGİSİ ASLA TAŞINMAZ: network_demands yalnız demand_id taşır;
--    havuz DTO'su service role action'da customer_demands'ın kriter alanlarından
--    (tip, il/ilçe, bütçe ARALIĞI yuvarlanmış, oda) derlenir — müşteri adı,
--    iletişim, mahalle, serbest kriter notu asla çıkmaz.
--  * RLS GEVŞETİLMEDİ: her tenant yalnız kendi network_demands satırlarını
--    görür/yönetir; çapraz okuma tek yol `listNetworkDemandPool` (service role +
--    maskeli DTO). Yanıtlar taraf bazlı (from/to) politikalarla kilitli.
--  * unique(demand_id): bir talep ağda tek kayıt (paused dahil); tekrar
--    paylaşım mevcut kaydı günceller.
--  * property_hint: öneren ofisin SERBEST maskeli özeti ("Kadıköy · Daire ·
--    3+1 · ₺5,2M") — portföy id'si/adresi DB'de tutulmaz, bağ kurulmaz;
--    ayrıntı ancak kabul sonrası telefonla konuşulur.
--  * commission_share_pct 0-50: portföy tarafıyla aynı gerçekçilik sınırı.

-- ============================================================
-- network_demands — ağa açılan alıcı talepleri (opt-in kaydı)
-- ============================================================
create table if not exists public.network_demands (
  id                   uuid        primary key default gen_random_uuid(),
  tenant_id            uuid        not null references public.tenants(id)           on delete cascade,
  demand_id            uuid        not null references public.customer_demands(id)  on delete cascade,
  commission_share_pct numeric(5,2) not null
                                   check (commission_share_pct >= 0 and commission_share_pct <= 50),
  note                 text,
  status               text        not null default 'active'
                                   check (status in ('active', 'paused')),
  created_by           uuid        references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  unique (demand_id)
);

comment on table  public.network_demands is
  'Ağ talep havuzu opt-in kayıtları — müşteri bilgisi taşınmaz, çapraz okuma yalnız service role action ile maskeli';
comment on column public.network_demands.commission_share_pct is
  'Portföyü getiren ofise önerilen komisyon paylaşım yüzdesi (0-50)';

create index if not exists idx_network_demands_tenant
  on public.network_demands (tenant_id, status, created_at desc);

create index if not exists idx_network_demands_status
  on public.network_demands (status, created_at desc);

-- ============================================================
-- network_demand_responses — "uygun portföyüm var" yanıtları (iki taraflı)
-- ============================================================
create table if not exists public.network_demand_responses (
  id                uuid        primary key default gen_random_uuid(),
  network_demand_id uuid        not null references public.network_demands(id) on delete cascade,
  from_tenant_id    uuid        not null references public.tenants(id) on delete cascade,
  to_tenant_id      uuid        not null references public.tenants(id) on delete cascade,
  property_hint     text        not null,
  message           text,
  status            text        not null default 'pending'
                                check (status in ('pending', 'accepted', 'rejected', 'withdrawn')),
  responded_at      timestamptz,
  created_by        uuid        references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  check (from_tenant_id <> to_tenant_id)
);

comment on table  public.network_demand_responses is
  'Ağ talep yanıtları — from tarafı (portföy sahibi) oluşturur/geri çeker, to tarafı (talep sahibi) yanıtlar';
comment on column public.network_demand_responses.property_hint is
  'Öneren ofisin serbest MASKELİ portföy özeti (ilçe · tip · oda · fiyat) — portföy id/adres bağlanmaz';
comment on column public.network_demand_responses.status is
  'pending: bekliyor | accepted: kabul (iletişim açılır) | rejected: ret | withdrawn: geri çekildi';

create index if not exists idx_network_demand_responses_demand
  on public.network_demand_responses (network_demand_id, status);

create index if not exists idx_network_demand_responses_from
  on public.network_demand_responses (from_tenant_id, created_at desc);

create index if not exists idx_network_demand_responses_to
  on public.network_demand_responses (to_tenant_id, status, created_at desc);

-- ============================================================
-- RLS — havuzun çapraz okuması BURADA DEĞİL (service role action'da)
-- ============================================================
alter table public.network_demands          enable row level security;
alter table public.network_demand_responses enable row level security;

drop policy if exists network_demands_tenant           on public.network_demands;
drop policy if exists network_demands_tenant_insert    on public.network_demands;
drop policy if exists network_demand_responses_select  on public.network_demand_responses;
drop policy if exists network_demand_responses_insert  on public.network_demand_responses;
drop policy if exists network_demand_responses_respond on public.network_demand_responses;
drop policy if exists network_demand_responses_withdraw on public.network_demand_responses;

-- Tenant kendi ağ talep kayıtlarını yönetir; başka ofisin kaydı GÖRÜNMEZ.
create policy network_demands_tenant on public.network_demands
  using (tenant_id = public.current_tenant_id());

create policy network_demands_tenant_insert on public.network_demands for insert
  with check (tenant_id = public.current_tenant_id());

-- Her iki taraf yalnız KENDİ tarafında olduğu yanıtları okur.
create policy network_demand_responses_select on public.network_demand_responses for select
  using (
    from_tenant_id = public.current_tenant_id()
    or to_tenant_id = public.current_tenant_id()
  );

-- Yanıtı yalnız from tarafı kendi adına açabilir (to alanına kendini yazamaz — tablo check'i).
create policy network_demand_responses_insert on public.network_demand_responses for insert
  with check (from_tenant_id = public.current_tenant_id());

-- Karar: yalnız to tarafı (talep sahibi), yalnız bekleyen yanıtı,
-- yalnız accepted/rejected'a çevirebilir; taraf kolonları değişemez.
create policy network_demand_responses_respond on public.network_demand_responses for update
  using (
    to_tenant_id = public.current_tenant_id()
    and status = 'pending'
  )
  with check (
    to_tenant_id = public.current_tenant_id()
    and status in ('accepted', 'rejected')
  );

-- Geri çekme: yalnız from tarafı, yalnız bekleyen yanıtı, yalnız withdrawn'a çevirebilir.
create policy network_demand_responses_withdraw on public.network_demand_responses for update
  using (
    from_tenant_id = public.current_tenant_id()
    and status = 'pending'
  )
  with check (
    from_tenant_id = public.current_tenant_id()
    and status = 'withdrawn'
  );

grant all on public.network_demands          to authenticated, service_role;
grant all on public.network_demand_responses to authenticated, service_role;
