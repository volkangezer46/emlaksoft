-- MIGRATION 20261007000220_lc_district_sla_reset.sql
-- UYGULANMADI (DOGRULANMADI): yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261007000220_lc_district_sla_reset.sql` ile uygular (PB46, 000210'dan SONRA).
-- Geri alma: supabase/rollbacks/20261007000220_lc_district_sla_reset.rollback.sql
-- BAGIMLILIK: 20260826002040 (property_control_state k_* bayraklari), 20260826002030 (listing_anomalies, listing_sla_events).
--
-- 1) BOLGE (ILCE) KIRILIMI: listing_control_district_summary + listing_control_list_district. SECURITY INVOKER: sayi da
--    liste de property_control_state RLS'i (danisman kendi, takim lideri takim, sube muduru sube, owner/gm ofis) ile ayni
--    kapsamda daralir. Sayi ve liste AYNI k_* kolonundan okunur (sifir cikmaz metrik); ilcesiz portfoyler district_id null
--    satirinda toplanir ve listesi `p_district_id is null` ile ayni kosulu kullanir.
-- 2) SLA YENIDEN ACILIS DUZELTMESI: lc_sync_anomalies yeniden acilan anomalide sla_stage'i 0'a ceker ama
--    listing_sla_events (anomali, asama) tekil kayitlari kaldigi icin yeniden acilan uyari HIC yukseltilmiyordu (eski
--    asamalar "zaten tetiklendi" sayiliyordu). Tetikleyici yeniden acilista (resolved/auto_closed -> open) o anomalinin
--    asama kayitlarini siler; zincir bastan isler. Eylem gunlugu (listing_anomaly_actions) ve bildirimler KALIR.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.property_control_state') is null
     or pg_catalog.to_regclass('public.listing_sla_events') is null
     or pg_catalog.to_regclass('public.listing_anomalies') is null then
    raise exception 'ilan kontrol tablolari yok; once 20260826002030..002040 uygulanmali.';
  end if;
end $$;

create or replace function public.listing_control_district_summary(p_include_sample boolean default false)
returns table (
  district_id uuid, district_name text, total_active bigint, in_portals bigint, awaiting_publish bigint,
  portal_missing bigint, price_mismatch bigint, in_review bigint, unverifiable bigint, healthy bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.district_id,
         max(d.name),
         count(*) filter (where s.k_active),
         count(*) filter (where s.k_in_portals),
         count(*) filter (where s.k_awaiting_publish),
         count(*) filter (where s.k_portal_missing),
         count(*) filter (where s.k_price_mismatch),
         count(*) filter (where s.k_in_review),
         count(*) filter (where s.k_unverifiable),
         count(*) filter (where s.k_healthy)
    from public.property_control_state s
    join public.properties p on p.id = s.property_id and p.tenant_id = s.tenant_id
    left join public.geo_districts d on d.id = p.district_id
   where s.tenant_id = (select public.current_tenant_id())
     and (p_include_sample or not s.is_sample)
     and s.k_active
   group by p.district_id
$$;

create or replace function public.listing_control_list_district(
  p_kpi text,
  p_district_id uuid,
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
    join public.properties p on p.id = s.property_id and p.tenant_id = s.tenant_id
   where s.tenant_id = (select public.current_tenant_id())
     and (p_include_sample or not s.is_sample)
     and p.district_id is not distinct from p_district_id
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
     and (p_after_id is null or (s.risk_score, s.property_id) < (coalesce(p_after_risk, 101), p_after_id))
   order by s.risk_score desc, s.property_id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

revoke all on function public.listing_control_district_summary(boolean) from public, anon;
revoke all on function public.listing_control_list_district(text, uuid, integer, smallint, uuid, boolean) from public, anon;
grant execute on function public.listing_control_district_summary(boolean) to authenticated, service_role;
grant execute on function public.listing_control_list_district(text, uuid, integer, smallint, uuid, boolean) to authenticated, service_role;

create or replace function public.lc_reset_sla_on_reopen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('resolved', 'auto_closed') and new.status = 'open' then
    begin
      delete from public.listing_sla_events where anomaly_id = new.id and tenant_id = new.tenant_id;
    exception when others then
      null;
    end;
  end if;
  return null;
end;
$$;
revoke all on function public.lc_reset_sla_on_reopen() from public, anon, authenticated, service_role;

drop trigger if exists trg_lc_reset_sla_on_reopen on public.listing_anomalies;
create trigger trg_lc_reset_sla_on_reopen after update of status on public.listing_anomalies
  for each row execute function public.lc_reset_sla_on_reopen();

notify pgrst, 'reload schema';
