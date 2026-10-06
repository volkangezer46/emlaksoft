-- MIGRATION 20260826002600_platform_insights.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826002600_platform_insights.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826002600_platform_insights.rollback.sql
-- BAGIMLILIK: public.platform_staff (20260722000024 platform_notifications ile ayni alici kalibi), public.tenants,
--   public.is_platform_staff().
--
-- AMAC: Platform personeli (EmlakSoft ekibi) icin ayni sema: churn sinyali, gelir anomalisi, sistem sagligi.
--   `insights`tan ayri tablo: tenant ofisi icgorusu ile platform icgorusu karismaz (platform_notifications ayrimiyla ayni).
--   tenant_id NULL olabilir (ilgili ofis varsa dolu). Bu dosya yalniz SEMA; uretici kurallar sonraki paket (P6).
--
-- KONTRAT: href NOT NULL, dedupe unique (staff_id, dedupe_key), RLS alici = auth.uid() VE platform personeli,
--   yazma yalniz service_role, durum degisimi platform_insight_set_state RPC.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.platform_staff') is null then
    raise exception 'public.platform_staff yok; once 20260722000024 oncesi platform migrationlari uygulanmali.';
  end if;
  if pg_catalog.to_regprocedure('public.is_platform_staff()') is null then
    raise exception 'is_platform_staff() yok.';
  end if;
end $$;

create table if not exists public.platform_insights (
  id               uuid primary key default gen_random_uuid(),
  staff_id         uuid not null references public.platform_staff(id) on delete cascade,
  tenant_id        uuid references public.tenants(id) on delete cascade,
  kind             text not null check (kind in (
    'tenant_churn', 'revenue_anomaly', 'payment_risk', 'system_health', 'partner_signal', 'anomaly', 'forecast', 'digest'
  )),
  rule_id          text not null check (char_length(rule_id) between 3 and 80),
  severity         text not null check (severity in ('bilgi', 'orta', 'yuksek')),
  priority         smallint not null default 0 check (priority between 0 and 100),
  title            text not null check (char_length(title) between 1 and 200),
  why              text not null check (char_length(why) between 1 and 600),
  evidence         jsonb not null default '[]'::jsonb,
  href             text not null check (char_length(href) between 1 and 500 and href like '/%'),
  entity_type      text check (entity_type is null or char_length(entity_type) <= 40),
  entity_id        uuid,
  is_forecast      boolean not null default false,
  confidence       text check (confidence is null or confidence in ('dusuk', 'orta', 'yuksek')),
  dedupe_key       text not null check (char_length(dedupe_key) between 3 and 200),
  state            text not null default 'new' check (state in ('new', 'seen', 'snoozed', 'dismissed', 'accepted')),
  state_reason     text check (state_reason is null or state_reason in ('yanlis', 'zaten_yaptim', 'ilgisiz', 'sonra')),
  snoozed_until    timestamptz,
  valid_until      timestamptz not null,
  notified_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (staff_id, dedupe_key)
);

create index if not exists idx_platform_insights_staff_open
  on public.platform_insights (staff_id, priority desc)
  where state in ('new', 'seen', 'snoozed');
create index if not exists idx_platform_insights_valid_until
  on public.platform_insights (valid_until);
create index if not exists idx_platform_insights_tenant
  on public.platform_insights (tenant_id) where tenant_id is not null;

alter table public.platform_insights enable row level security;

-- Alici kendi satirini okur VE aktif platform personeli olmalidir (kalip: platform_notifications).
drop policy if exists platform_insights_select on public.platform_insights;
create policy platform_insights_select on public.platform_insights
  for select using (staff_id = (select auth.uid()) and (select public.is_platform_staff()));

-- Yazma politikasi YOK; engine = service_role.
revoke all on public.platform_insights from anon, authenticated;
grant select on public.platform_insights to authenticated;
grant all on public.platform_insights to service_role;

comment on table public.platform_insights is
  'Platform personeli icgoru kuyrugu (churn/gelir/sistem sagligi). Yazma yalniz service_role.';

create or replace function public.platform_insight_set_state(
  p_id uuid,
  p_state text,
  p_reason text default null,
  p_snooze_until timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_until timestamptz;
  v_rows int;
begin
  if v_uid is null or not public.is_platform_staff() then
    return false;
  end if;
  if p_state not in ('seen', 'snoozed', 'dismissed', 'accepted') then
    raise exception 'gecersiz icgoru durumu: %', p_state using errcode = '22023';
  end if;
  if p_reason is not null and p_reason not in ('yanlis', 'zaten_yaptim', 'ilgisiz', 'sonra') then
    raise exception 'gecersiz yoksay nedeni: %', p_reason using errcode = '22023';
  end if;
  if p_state = 'snoozed' then
    v_until := coalesce(p_snooze_until, pg_catalog.now() + interval '1 day');
    if v_until <= pg_catalog.now() then v_until := pg_catalog.now() + interval '1 day'; end if;
    if v_until > pg_catalog.now() + interval '30 days' then v_until := pg_catalog.now() + interval '30 days'; end if;
  end if;

  update public.platform_insights i
     set state = p_state,
         state_reason = case when p_state = 'dismissed' then p_reason else null end,
         snoozed_until = case when p_state = 'snoozed' then v_until else null end,
         updated_at = pg_catalog.now()
   where i.id = p_id
     and i.staff_id = v_uid
     and i.state not in ('dismissed', 'accepted')
     and (p_state <> 'seen' or i.state = 'new');
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.platform_insight_set_state(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.platform_insight_set_state(uuid, text, text, timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';

-- DOGRULAMA (salt-okunur):
-- select to_regclass('public.platform_insights') is not null as tablo,
--        (select relrowsecurity from pg_class where oid = 'public.platform_insights'::regclass) as rls,
--        has_function_privilege('anon', 'public.platform_insight_set_state(uuid,text,text,timestamptz)', 'execute') as anon_rpc;
-- Beklenen: t | t | f
