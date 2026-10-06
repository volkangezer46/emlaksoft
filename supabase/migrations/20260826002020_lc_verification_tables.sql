-- MIGRATION 20260826002020_lc_verification_tables.sql
-- UYGULANMADI (DOGRULANMADI): yalniz backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826002020_lc_verification_tables.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826002020_lc_verification_tables.rollback.sql
-- BAGIMLILIK: 20260826002000 (portal_listings zinciri), 20260826002010 (lc_row_visible).
--
-- TABLOLAR (hepsi YENI; yazma yalniz service_role/RPC, okuma rol kapsamli):
--   portal_listing_health      1:1 portal_listings. SIK degisen alanlar (son kontrol, portal fiyati/basligi/danismani,
--                              sayaclar, kontrol durumu). portal_listings Realtime'da oldugu icin buraya ayrildi. fillfactor 80.
--   listing_verifications      kontrol sonuc gunlugu (append-only; ham HTML YOK, yalniz gozlenen fiyat/baslik/durum).
--   listing_verification_jobs  dagitik is kuyrugu; ayni ilan icin tek acik is (kismi unique) -> iki cihaz ayni ilani alamaz.
--   verification_clients       kontrol istemcisi (cihaz) kaydi; yalniz token HASH'i saklanir.
-- Kontrol DURUMLARI: unchecked | verified | suspect | probable_missing | confirmed_missing | unverifiable | paused.
-- blocked/error (giris duvari, CAPTCHA, 403/429, zaman asimi) ASLA kayip sayilmaz -> unverifiable.
-- Saklama: listing_verifications 60 gun (operational-retention cron'una sonra eklenir); partition ayri is.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.portal_listings') is null
     or not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = 'lc_row_visible') then
    raise exception 'portal_listings veya lc_row_visible yok; once 20260826002000 ve 20260826002010 uygulanmali.';
  end if;
end $$;

create table if not exists public.verification_clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_id uuid,
  label text not null check (char_length(label) between 1 and 80),
  token_hash text not null check (char_length(token_hash) = 64),
  token_rotated_at timestamptz not null default now(),
  capabilities jsonb not null default '{}'::jsonb,
  os_hint text check (os_hint is null or char_length(os_hint) <= 40),
  last_seen_at timestamptz,
  last_claim_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint verification_clients_profile_tenant_fkey
    foreign key (profile_id, tenant_id) references public.profiles (id, tenant_id) on delete set null (profile_id),
  unique (id, tenant_id),
  unique (token_hash)
);
create index if not exists idx_verification_clients_tenant on public.verification_clients (tenant_id, last_claim_at);

create table if not exists public.portal_listing_health (
  portal_listing_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null,
  -- Kapsam kolonlari (denormalize; RLS satir basina alt sorgu cagirmasin). Yazan taraf properties'ten doldurur.
  branch_id uuid,
  team_id uuid,
  advisor_id uuid,
  check_state text not null default 'unchecked'
    check (check_state in ('unchecked', 'verified', 'suspect', 'probable_missing', 'confirmed_missing', 'unverifiable', 'paused')),
  confidence numeric(3, 2) check (confidence is null or confidence between 0 and 1),
  consecutive_absent smallint not null default 0 check (consecutive_absent >= 0),
  first_absent_at timestamptz,
  last_absent_at timestamptz,
  absent_client_ids uuid[] not null default '{}',
  last_check_at timestamptz,
  last_success_at timestamptz,
  last_seen_at timestamptz,
  last_check_result text check (last_check_result is null or last_check_result in ('present', 'absent', 'blocked', 'error')),
  check_failures smallint not null default 0 check (check_failures >= 0),
  error_code text check (error_code is null or char_length(error_code) <= 60),
  portal_price numeric,
  portal_title text check (portal_title is null or char_length(portal_title) <= 300),
  portal_advisor_name text check (portal_advisor_name is null or char_length(portal_advisor_name) <= 120),
  portal_status text check (portal_status is null or char_length(portal_status) <= 40),
  portal_active boolean,
  last_source_kind text check (last_source_kind is null or last_source_kind in ('manual', 'api', 'feed', 'csv', 'assisted')),
  last_client_id uuid,
  next_check_at timestamptz,
  check_priority smallint not null default 0,
  updated_at timestamptz not null default now(),
  constraint portal_listing_health_listing_tenant_fkey
    foreign key (portal_listing_id, tenant_id) references public.portal_listings (id, tenant_id) on delete cascade
) with (fillfactor = 80);
create index if not exists idx_plh_due on public.portal_listing_health (tenant_id, next_check_at) where check_state <> 'paused';
create index if not exists idx_plh_state on public.portal_listing_health (tenant_id, check_state);
create index if not exists idx_plh_property on public.portal_listing_health (tenant_id, property_id);
create index if not exists idx_plh_advisor on public.portal_listing_health (tenant_id, advisor_id);

create table if not exists public.listing_verifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  portal_listing_id uuid not null,
  property_id uuid not null,
  branch_id uuid,
  team_id uuid,
  advisor_id uuid,
  checked_at timestamptz not null default now(),
  result text not null check (result in ('present', 'absent', 'blocked', 'error')),
  source_kind text not null check (source_kind in ('manual', 'api', 'feed', 'csv', 'assisted')),
  client_id uuid,
  job_id uuid,
  observed jsonb not null default '{}'::jsonb check (pg_column_size(observed) <= 4096),
  evidence_hash text check (evidence_hash is null or char_length(evidence_hash) <= 128),
  confidence numeric(3, 2) check (confidence is null or confidence between 0 and 1),
  state_before text,
  state_after text,
  constraint listing_verifications_listing_tenant_fkey
    foreign key (portal_listing_id, tenant_id) references public.portal_listings (id, tenant_id) on delete cascade
);
create index if not exists idx_listing_verifications_listing on public.listing_verifications (portal_listing_id, checked_at desc);
create index if not exists idx_listing_verifications_tenant on public.listing_verifications (tenant_id, checked_at desc);
create unique index if not exists uq_listing_verifications_job on public.listing_verifications (job_id) where job_id is not null;

create table if not exists public.listing_verification_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  listing_id uuid not null,
  property_id uuid not null,
  portal text not null,
  priority smallint not null default 0,
  reason text not null default 'scheduled'
    check (reason in ('scheduled', 'suspect_recheck', 'third_party', 'manual_request')),
  scheduled_at timestamptz not null default now(),
  assigned_client_id uuid,
  exclude_client_ids uuid[] not null default '{}',
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  status text not null default 'queued'
    check (status in ('queued', 'claimed', 'completed', 'failed', 'expired', 'cancelled', 'skipped')),
  retry_count smallint not null default 0 check (retry_count >= 0),
  created_at timestamptz not null default now(),
  constraint listing_verification_jobs_listing_tenant_fkey
    foreign key (listing_id, tenant_id) references public.portal_listings (id, tenant_id) on delete cascade
);
-- ZORUNLU: ayni ilan icin ayni anda tek acik is.
create unique index if not exists uq_listing_verification_jobs_open
  on public.listing_verification_jobs (listing_id) where status in ('queued', 'claimed');
create index if not exists idx_lvj_queue on public.listing_verification_jobs (tenant_id, status, priority desc, scheduled_at);
create index if not exists idx_lvj_lease on public.listing_verification_jobs (lease_expires_at) where status = 'claimed';

alter table public.verification_clients enable row level security;
alter table public.portal_listing_health enable row level security;
alter table public.listing_verifications enable row level security;
alter table public.listing_verification_jobs enable row level security;

-- Okuma: portal modulu goruntuleme izni + rol kapsami. Yazma politikasi YOK (yalniz service_role/RPC).
create policy portal_listing_health_select on public.portal_listing_health for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('portals', 'view'))
  and (select public.lc_row_visible(branch_id, team_id, advisor_id))
);
create policy listing_verifications_select on public.listing_verifications for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('portals', 'view'))
  and (select public.lc_row_visible(branch_id, team_id, advisor_id))
);
-- Kuyruk ve cihazlar yonetim kademesi: yalniz owner/gm okur.
create policy listing_verification_jobs_select on public.listing_verification_jobs for select to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.current_profile_role()) in ('owner', 'gm'));
create policy verification_clients_select on public.verification_clients for select to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.current_profile_role()) in ('owner', 'gm'));

revoke all on table public.verification_clients from public, anon, authenticated;
revoke all on table public.portal_listing_health from public, anon, authenticated;
revoke all on table public.listing_verifications from public, anon, authenticated;
revoke all on table public.listing_verification_jobs from public, anon, authenticated;
grant select on table public.portal_listing_health to authenticated;
grant select on table public.listing_verifications to authenticated;
grant select on table public.listing_verification_jobs to authenticated;
-- token_hash istemciye sizmasin: sutun bazli select (token_hash haric).
grant select (id, tenant_id, profile_id, label, token_rotated_at, capabilities, os_hint, last_seen_at, last_claim_at, revoked_at, created_at)
  on table public.verification_clients to authenticated;
grant all on table public.verification_clients to service_role;
grant all on table public.portal_listing_health to service_role;
grant all on table public.listing_verifications to service_role;
grant all on table public.listing_verification_jobs to service_role;

notify pgrst, 'reload schema';
