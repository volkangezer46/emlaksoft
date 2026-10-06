-- MIGRATION 20260826002030_lc_anomaly_tables.sql
-- UYGULANMADI (DOGRULANMADI): yalniz backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826002030_lc_anomaly_tables.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826002030_lc_anomaly_tables.rollback.sql
-- BAGIMLILIK: 20260826002000, 20260826002010.
--
-- TABLOLAR (YENI; yazma yalniz service_role/RPC; aciklama/kapatma 20260826002060 RPC'leriyle):
--   listing_anomalies         durumlu + SLA'li veri uyusmazliklari (oversight_alert_reviews'in aksine: o durumsuz hesaplanan
--                             davranis uyarilarinin inceleme izidir). dedupe_key ile ayni olay tekrar acilmaz.
--   listing_anomaly_actions   anomali zaman cizgisi/denetim izi (acildi, aciklandi, yukseltildi, kapatildi...).
--   listing_sla_events        SLA yukseltme asamalari (4/8/24 saat zinciri); (anomali, asama) tekil -> ayni asama tekrar
--                             bildirilmez (havuzdaki `seen` kumesinin DB karsiligi).
--   listing_matching_candidates  kayitsiz portal ilani -> portfoy eslestirme adaylari (property_id NOT NULL oldugundan
--                             portal_listings'e girmez).
-- Mevcut tabloyla mukerrer YOK: durum/fiyat gecmisi property_status_history/property_price_history'de kalir
-- (20260826002070 yalniz nullable neden kolonlari ekler).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.portal_listings') is null
     or not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = 'lc_row_visible') then
    raise exception 'portal_listings veya lc_row_visible yok; once 20260826002000 ve 20260826002010 uygulanmali.';
  end if;
end $$;

create table if not exists public.listing_anomalies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null,
  portal_listing_id uuid,
  type text not null check (type in
    ('portal_missing', 'not_published', 'unregistered_listing', 'bulk_mismatch', 'price_mismatch', 'advisor_mismatch',
     'duplicate', 'potential_lost_deal', 'sold_still_listed', 'incomplete_closure', 'authority_expiring')),
  severity text not null default 'medium' check (severity in ('info', 'low', 'medium', 'high', 'critical')),
  status text not null default 'open'
    check (status in ('open', 'acknowledged', 'explained', 'resolved', 'false_positive', 'auto_closed')),
  dedupe_key text not null check (char_length(dedupe_key) between 3 and 200),
  branch_id uuid,
  team_id uuid,
  advisor_id uuid,
  assignee_id uuid,
  risk_score smallint check (risk_score is null or risk_score between 0 and 100),
  risk_points jsonb not null default '[]'::jsonb,
  details jsonb not null default '{}'::jsonb check (pg_column_size(details) <= 8192),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  sla_stage smallint not null default 0 check (sla_stage between 0 and 4),
  sla_due_at timestamptz,
  explained_reason_code text check (explained_reason_code is null or explained_reason_code in
    ('sold', 'rented', 'owner_withdrew', 'authority_expired', 'price_will_update', 'portal_removed', 'will_republish', 'mistake', 'other')),
  explained_note text check (explained_note is null or char_length(explained_note) <= 500),
  explained_by uuid,
  explained_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint listing_anomalies_property_tenant_fkey
    foreign key (property_id, tenant_id) references public.properties (id, tenant_id) on delete cascade,
  unique (tenant_id, dedupe_key),
  unique (id, tenant_id)
);
create index if not exists idx_listing_anomalies_queue on public.listing_anomalies (tenant_id, status, severity, sla_due_at);
create index if not exists idx_listing_anomalies_assignee on public.listing_anomalies (tenant_id, advisor_id)
  where status in ('open', 'acknowledged', 'explained');
create index if not exists idx_listing_anomalies_property on public.listing_anomalies (tenant_id, property_id, status);
create index if not exists idx_listing_anomalies_sla on public.listing_anomalies (sla_due_at)
  where status in ('open', 'acknowledged') and sla_due_at is not null;

create table if not exists public.listing_anomaly_actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  anomaly_id uuid not null,
  action text not null check (action in
    ('opened', 'reopened', 'acknowledged', 'explained', 'resolved', 'false_positive', 'auto_closed', 'escalated',
     'task_created', 'notified', 'assigned')),
  actor_id uuid,
  stage smallint,
  reason_code text,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  constraint listing_anomaly_actions_anomaly_fkey
    foreign key (anomaly_id, tenant_id) references public.listing_anomalies (id, tenant_id) on delete cascade
);
create index if not exists idx_listing_anomaly_actions_anomaly on public.listing_anomaly_actions (anomaly_id, created_at);
create index if not exists idx_listing_anomaly_actions_tenant on public.listing_anomaly_actions (tenant_id, created_at desc);

create table if not exists public.listing_sla_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  anomaly_id uuid not null,
  stage smallint not null check (stage between 1 and 4),
  recipient_role text not null check (recipient_role in ('advisor', 'team_lead', 'branch_manager', 'owner')),
  recipient_id uuid,
  due_at timestamptz,
  fired_at timestamptz not null default now(),
  notification_key text check (notification_key is null or char_length(notification_key) <= 200),
  constraint listing_sla_events_anomaly_fkey
    foreign key (anomaly_id, tenant_id) references public.listing_anomalies (id, tenant_id) on delete cascade,
  unique (anomaly_id, stage)
);
create index if not exists idx_listing_sla_events_tenant on public.listing_sla_events (tenant_id, fired_at desc);

create table if not exists public.listing_matching_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  portal text not null,
  external_id text not null check (char_length(external_id) between 1 and 200),
  url text check (url is null or char_length(url) <= 2048),
  title text check (title is null or char_length(title) <= 300),
  price numeric,
  source_kind text not null default 'csv' check (source_kind in ('manual', 'api', 'feed', 'csv', 'assisted')),
  -- [{property_id, score (0-100), signals:[{key,label,points,max}]}] KISISEL VERI ICERMEZ.
  candidates jsonb not null default '[]'::jsonb check (pg_column_size(candidates) <= 8192),
  top_score numeric(5, 2) check (top_score is null or top_score between 0 and 100),
  status text not null default 'open' check (status in ('open', 'linked', 'ignored')),
  linked_listing_id uuid,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  unique (tenant_id, portal, external_id)
);
create index if not exists idx_lmc_queue on public.listing_matching_candidates (tenant_id, status, top_score desc);

alter table public.listing_anomalies enable row level security;
alter table public.listing_anomaly_actions enable row level security;
alter table public.listing_sla_events enable row level security;
alter table public.listing_matching_candidates enable row level security;

create policy listing_anomalies_select on public.listing_anomalies for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('portals', 'view'))
  and (select public.lc_row_visible(branch_id, team_id, advisor_id))
);
create policy listing_anomaly_actions_select on public.listing_anomaly_actions for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('portals', 'view'))
  and exists (
    select 1 from public.listing_anomalies a
    where a.id = anomaly_id and a.tenant_id = listing_anomaly_actions.tenant_id
      and (select public.lc_row_visible(a.branch_id, a.team_id, a.advisor_id))
  )
);
create policy listing_sla_events_select on public.listing_sla_events for select to authenticated
using (tenant_id = (select public.current_tenant_id()) and (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager'));
-- Eslestirme adaylari ofis geneli bir envanter isi: yonetim kademesi okur.
create policy listing_matching_candidates_select on public.listing_matching_candidates for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('portals', 'view'))
  and (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager')
);

revoke all on table public.listing_anomalies from public, anon, authenticated;
revoke all on table public.listing_anomaly_actions from public, anon, authenticated;
revoke all on table public.listing_sla_events from public, anon, authenticated;
revoke all on table public.listing_matching_candidates from public, anon, authenticated;
grant select on table public.listing_anomalies to authenticated;
grant select on table public.listing_anomaly_actions to authenticated;
grant select on table public.listing_sla_events to authenticated;
grant select on table public.listing_matching_candidates to authenticated;
grant all on table public.listing_anomalies to service_role;
grant all on table public.listing_anomaly_actions to service_role;
grant all on table public.listing_sla_events to service_role;
grant all on table public.listing_matching_candidates to service_role;

notify pgrst, 'reload schema';
