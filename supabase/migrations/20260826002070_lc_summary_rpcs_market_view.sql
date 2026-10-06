-- MIGRATION 20260826002070_lc_summary_rpcs_market_view.sql
-- UYGULANMADI (DOGRULANMADI): yalniz backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826002070_lc_summary_rpcs_market_view.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826002070_lc_summary_rpcs_market_view.rollback.sql
-- BAGIMLILIK: 20260826002000..002060 (property_control_state, listing_anomalies, listing_verifications).
--
-- 1) KPI/liste/"dunden beri" RPC'leri: SECURITY INVOKER -> property_control_state RLS'i (danisman kendi, takim lideri takim,
--    sube muduru sube, owner/gm sirket) sayiyi de listeyi de AYNI kapsamda daraltir. Sunucu tarafi agregasyon (bellek taramasi yok).
--    Sayi ve liste ayni k_* kolonundan gelir (sifir cikmaz metrik).
-- 1b) service_role: lc_upsert_control_states (motor sonucunu yazar) + lc_sweep_candidates (degerlendirme taramasi adaylari).
-- 2) Gecmis genisletme: property_status_history'ye nullable kodlu neden kolonlari (yeni gecmis tablosu ACILMAZ).
--    Fiyat gecmisi icin yeni kolon YOK: portal fiyati listing_verifications.observed ve portal_listing_health'tedir.
-- 3) control_market_signals_v: Emlakfiyati icin ANONIM agregat HAZIRLIK gorunumu. Ilan kodu/adres/malik/danisman YOK.
--    Dis aktarim YOK; gorunum yalniz service_role'e acik (authenticated/anon revoke). k-anonimlik (k>=5) ve ofis opt-in
--    karari gelecek is (src/lib/listing-control/market-signals.ts yalniz saf toplayici).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.property_control_state') is null
     or pg_catalog.to_regclass('public.listing_anomalies') is null
     or pg_catalog.to_regclass('public.listing_verifications') is null then
    raise exception 'ilan kontrol tablolari yok; once 20260826002020..002040 uygulanmali.';
  end if;
end $$;

create or replace function public.listing_control_summary(
  p_group_by text default 'tenant',
  p_include_sample boolean default false
)
returns table (
  group_kind text, group_id uuid, total_active bigint, in_portals bigint, awaiting_publish bigint,
  portal_missing bigint, price_mismatch bigint, in_review bigint, unverifiable bigint, healthy bigint,
  healthy_ratio numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    case when p_group_by in ('branch', 'team', 'advisor') then p_group_by else 'tenant' end,
    case p_group_by when 'branch' then s.branch_id when 'team' then s.team_id when 'advisor' then s.advisor_id end,
    count(*) filter (where s.k_active),
    count(*) filter (where s.k_in_portals),
    count(*) filter (where s.k_awaiting_publish),
    count(*) filter (where s.k_portal_missing),
    count(*) filter (where s.k_price_mismatch),
    count(*) filter (where s.k_in_review),
    count(*) filter (where s.k_unverifiable),
    count(*) filter (where s.k_healthy),
    case when count(*) filter (where s.k_active) = 0 then null
         else round(100.0 * count(*) filter (where s.k_healthy) / count(*) filter (where s.k_active), 1) end
  from public.property_control_state s
  where s.tenant_id = (select public.current_tenant_id())
    and (p_include_sample or not s.is_sample)
  group by 1, 2
$$;

create or replace function public.listing_control_list(
  p_kpi text,
  p_group_by text default 'tenant',
  p_group_id uuid default null,
  p_limit integer default 50,
  p_after_risk smallint default null,
  p_after_id uuid default null,
  p_include_sample boolean default false
)
returns table (
  property_id uuid, risk_score smallint, health_score smallint, health_color text, lifecycle_stage text,
  advisor_id uuid, branch_id uuid, team_id uuid, open_anomalies smallint, portals_live smallint, last_verified_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.property_id, s.risk_score, s.health_score, s.health_color, s.lifecycle_stage,
         s.advisor_id, s.branch_id, s.team_id, s.open_anomalies, s.portals_live, s.last_verified_at
  from public.property_control_state s
  where s.tenant_id = (select public.current_tenant_id())
    and (p_include_sample or not s.is_sample)
    and case p_kpi
          when 'active' then s.k_active
          when 'in_portals' then s.k_in_portals
          when 'awaiting_publish' then s.k_awaiting_publish
          when 'portal_missing' then s.k_portal_missing
          when 'price_mismatch' then s.k_price_mismatch
          when 'in_review' then s.k_in_review
          when 'unverifiable' then s.k_unverifiable
          when 'healthy' then s.k_healthy
          else false end
    and (p_group_id is null or
         case p_group_by when 'branch' then s.branch_id when 'team' then s.team_id when 'advisor' then s.advisor_id end = p_group_id)
    and (p_after_id is null or (s.risk_score, s.property_id) < (coalesce(p_after_risk, 101), p_after_id))
  order by s.risk_score desc, s.property_id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

create or replace function public.listing_control_changes_since(p_since timestamptz)
returns table (
  anomalies_opened bigint, anomalies_closed bigint, newly_missing bigint, recovered bigint,
  checks_total bigint, checks_unverifiable bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (select count(*) from public.listing_anomalies a
      where a.tenant_id = (select public.current_tenant_id()) and a.first_seen_at >= p_since),
    (select count(*) from public.listing_anomalies a
      where a.tenant_id = (select public.current_tenant_id()) and a.resolved_at >= p_since),
    (select count(*) from public.listing_verifications v
      where v.tenant_id = (select public.current_tenant_id()) and v.checked_at >= p_since
        and v.state_after in ('probable_missing', 'confirmed_missing') and v.state_before is distinct from v.state_after),
    (select count(*) from public.listing_verifications v
      where v.tenant_id = (select public.current_tenant_id()) and v.checked_at >= p_since
        and v.state_after = 'verified' and v.state_before in ('suspect', 'probable_missing', 'confirmed_missing')),
    (select count(*) from public.listing_verifications v
      where v.tenant_id = (select public.current_tenant_id()) and v.checked_at >= p_since),
    (select count(*) from public.listing_verifications v
      where v.tenant_id = (select public.current_tenant_id()) and v.checked_at >= p_since and v.result in ('blocked', 'error'))
$$;

revoke all on function public.listing_control_summary(text, boolean) from public, anon;
revoke all on function public.listing_control_list(text, text, uuid, integer, smallint, uuid, boolean) from public, anon;
revoke all on function public.listing_control_changes_since(timestamptz) from public, anon;
grant execute on function public.listing_control_summary(text, boolean) to authenticated, service_role;
grant execute on function public.listing_control_list(text, text, uuid, integer, smallint, uuid, boolean) to authenticated, service_role;
grant execute on function public.listing_control_changes_since(timestamptz) to authenticated, service_role;

-- ---- service_role: kontrol durumu yazimi + degerlendirme taramasi ----
-- Motor (src/lib/listing-control/engine.ts) sonucunu yazar. branch/team/advisor/is_sample/assigned_at SQL'de properties'ten
-- doldurulur (takim kolonu varsa dinamik okunur); stage_since yalnizca asama degisince ilerler.
create or replace function public.lc_upsert_control_states(p_tenant_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_n integer;
  j jsonb;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return 0;
  end if;
  for j in select e from jsonb_array_elements(p_rows) as e limit 200 loop
    insert into public.property_control_state
      (property_id, tenant_id, branch_id, team_id, advisor_id, is_sample, lifecycle_stage, stage_since, exit_kind,
       health_score, health_color, health_partial, risk_score, portals_live, open_anomalies, assigned_at, last_verified_at,
       k_active, k_in_portals, k_awaiting_publish, k_portal_missing, k_price_mismatch, k_in_review, k_unverifiable, k_healthy)
    select pr.id, pr.tenant_id, pr.branch_id,
           (select nullif(to_jsonb(pf) ->> 'team_id', '')::uuid from public.profiles pf where pf.id = pr.assigned_to),
           pr.assigned_to, coalesce(pr.is_sample, false),
           j ->> 'lifecycle_stage', now(), nullif(j ->> 'exit_kind', ''),
           nullif(j ->> 'health_score', '')::smallint, nullif(j ->> 'health_color', ''),
           coalesce((j ->> 'health_partial')::boolean, false),
           coalesce(nullif(j ->> 'risk_score', '')::smallint, 0), coalesce((j ->> 'portals_live')::smallint, 0),
           coalesce((j ->> 'open_anomalies')::smallint, 0), nullif(j ->> 'assigned_at', '')::timestamptz,
           nullif(j ->> 'last_verified_at', '')::timestamptz,
           coalesce((j ->> 'k_active')::boolean, false), coalesce((j ->> 'k_in_portals')::boolean, false),
           coalesce((j ->> 'k_awaiting_publish')::boolean, false), coalesce((j ->> 'k_portal_missing')::boolean, false),
           coalesce((j ->> 'k_price_mismatch')::boolean, false), coalesce((j ->> 'k_in_review')::boolean, false),
           coalesce((j ->> 'k_unverifiable')::boolean, false), coalesce((j ->> 'k_healthy')::boolean, false)
      from public.properties pr
     where pr.id = (j ->> 'property_id')::uuid and pr.tenant_id = p_tenant_id
    on conflict (property_id) do update set
      branch_id = excluded.branch_id, team_id = excluded.team_id, advisor_id = excluded.advisor_id,
      is_sample = excluded.is_sample,
      stage_since = case when public.property_control_state.lifecycle_stage is distinct from excluded.lifecycle_stage
                         then now() else public.property_control_state.stage_since end,
      lifecycle_stage = excluded.lifecycle_stage, exit_kind = excluded.exit_kind,
      health_score = excluded.health_score, health_color = excluded.health_color, health_partial = excluded.health_partial,
      risk_score = excluded.risk_score, portals_live = excluded.portals_live, open_anomalies = excluded.open_anomalies,
      assigned_at = excluded.assigned_at, last_verified_at = excluded.last_verified_at,
      k_active = excluded.k_active, k_in_portals = excluded.k_in_portals, k_awaiting_publish = excluded.k_awaiting_publish,
      k_portal_missing = excluded.k_portal_missing, k_price_mismatch = excluded.k_price_mismatch,
      k_in_review = excluded.k_in_review, k_unverifiable = excluded.k_unverifiable, k_healthy = excluded.k_healthy,
      updated_at = now();
    get diagnostics v_n = row_count;
    v_count := v_count + v_n;
  end loop;
  return v_count;
end;
$$;

-- Degerlendirme taramasi adaylari: hic degerlendirilmemis ya da bayatlamis atanmis portfoyler (en eski once).
-- Yayinlanmayan portfoy, yetki bitisi gibi yavas degisen kosullari yakalar; kontrol sonucu olaylari anlik senkronlar.
create or replace function public.lc_sweep_candidates(p_limit integer default 300, p_stale_hours integer default 6)
returns table (tenant_id uuid, property_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.tenant_id, p.id
    from public.properties p
    left join public.property_control_state s on s.property_id = p.id
   where p.deleted_at is null
     and not coalesce(p.is_sample, false)
     and p.assigned_to is not null
     and p.status not in ('sold', 'rented', 'withdrawn', 'passive', 'archived', 'auth_expired')
     and (s.property_id is null or s.updated_at < now() - make_interval(hours => least(greatest(p_stale_hours, 1), 168)))
   order by (s.property_id is null) desc, s.updated_at asc nulls first
   limit least(greatest(p_limit, 1), 1000)
$$;

revoke all on function public.lc_upsert_control_states(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.lc_sweep_candidates(integer, integer) from public, anon, authenticated;
grant execute on function public.lc_upsert_control_states(uuid, jsonb) to service_role;
grant execute on function public.lc_sweep_candidates(integer, integer) to service_role;

-- Mevcut gecmis tablosunu GENISLET (mukerrer tablo yok).
do $$
begin
  if pg_catalog.to_regclass('public.property_status_history') is not null then
    alter table public.property_status_history add column if not exists reason_code text;
    alter table public.property_status_history add column if not exists exit_kind text;
    if not exists (select 1 from pg_catalog.pg_constraint where conname = 'property_status_history_exit_kind_check') then
      alter table public.property_status_history add constraint property_status_history_exit_kind_check
        check (exit_kind is null or exit_kind in
          ('sold', 'rented', 'cancelled', 'authority_expired', 'owner_withdrew', 'other_agency', 'portal_removed', 'passive', 'duplicate'));
    end if;
    if not exists (select 1 from pg_catalog.pg_constraint where conname = 'property_status_history_reason_code_check') then
      alter table public.property_status_history add constraint property_status_history_reason_code_check
        check (reason_code is null or char_length(reason_code) <= 60);
    end if;
  end if;
end $$;

-- Emlakfiyati anonim agregat HAZIRLIGI (dis aktarim YOK).
create or replace view public.control_market_signals_v with (security_invoker = true) as
with chain as (
  select pl.tenant_id, pl.property_id,
         min(pl.published_at) as first_published_at,
         max(pl.removed_at) filter (where pl.status <> 'live') as last_removed_at,
         count(*) as listing_rows,
         count(distinct lower(btrim(pl.portal_name))) as portal_count,
         sum(extract(epoch from (coalesce(pl.removed_at, now()) - pl.published_at)) / 86400.0) as published_days
    from public.portal_listings pl
   where pl.published_at is not null
   group by pl.tenant_id, pl.property_id
)
select
  p.tenant_id,
  p.district_id,
  p.property_type,
  p.transaction_type,
  date_trunc('month', c.first_published_at)::date as published_month,
  round(c.published_days)::integer as published_days,
  c.portal_count::integer as portal_count,
  (c.listing_rows - c.portal_count)::integer as relist_or_id_change_count,
  (select count(*) from public.property_price_history h
    where h.tenant_id = p.tenant_id and h.property_id = p.id and h.price_field = 'list_price'
      and h.created_at >= c.first_published_at)::integer as price_change_count,
  coalesce(fp.price, p.list_price) as first_list_price,
  p.list_price as last_list_price,
  case when coalesce(fp.price, p.list_price) > 0
       then round(((p.list_price - coalesce(fp.price, p.list_price)) / coalesce(fp.price, p.list_price) * 100)::numeric, 1) end as price_delta_pct,
  case p.status when 'sold' then 'sold' when 'rented' then 'rented' else 'open_or_exited' end as outcome,
  case when p.status in ('sold', 'rented')
       then round(extract(epoch from (coalesce(c.last_removed_at, now()) - c.first_published_at)) / 86400.0)::integer end as days_to_outcome
from chain c
join public.properties p on p.id = c.property_id and p.tenant_id = c.tenant_id and p.deleted_at is null and not p.is_sample
left join lateral (
  select coalesce(h.old_price, h.new_price) as price
    from public.property_price_history h
   where h.tenant_id = p.tenant_id and h.property_id = p.id and h.price_field = 'list_price'
   order by h.created_at asc
   limit 1
) fp on true;

revoke all on table public.control_market_signals_v from public, anon, authenticated;
grant select on table public.control_market_signals_v to service_role;

notify pgrst, 'reload schema';
