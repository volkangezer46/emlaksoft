-- 20261020010003 geri alma: customer_heat_signals dijital ilgi kolonlari olmadan 20260731000133 govdesine, customer_lead_signals
--   20260826001400 govdesine doner (aktarilan eski not yeniden son temas sayilir). Kod eksik kolonlari 0 sayar.
set local lock_timeout = '5s';

drop function if exists public.customer_heat_signals(uuid, uuid[]);

create or replace function public.customer_heat_signals(
  p_tenant_id uuid,
  p_customer_ids uuid[]
)
returns table(
  customer_id uuid,
  last_contact timestamptz,
  open_demands int,
  urgent_demands int,
  portal_likes_30d int,
  open_offers int,
  open_deals int
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id,
    greatest(m.last_at, a.last_at, ca.last_at),
    coalesce(d.cnt, 0)::int,
    coalesce(d.urgent, 0)::int,
    coalesce(pf.cnt, 0)::int,
    coalesce(o.cnt, 0)::int,
    coalesce(dl.cnt, 0)::int
  from public.customers c
  left join (
    select cd.customer_id,
           count(*) as cnt,
           count(*) filter (where cd.urgency in ('high', 'urgent')) as urgent
    from public.customer_demands cd
    where cd.tenant_id = public.assert_current_tenant(p_tenant_id)
      and cd.customer_id = any(p_customer_ids)
      and cd.status in ('new', 'active', 'matched')
    group by cd.customer_id
  ) d on d.customer_id = c.id
  left join (
    select cm.customer_id, max(cm.created_at) as last_at
    from public.communications cm
    where cm.tenant_id = public.assert_current_tenant(p_tenant_id)
      and cm.customer_id = any(p_customer_ids)
    group by cm.customer_id
  ) m on m.customer_id = c.id
  left join (
    select ap.customer_id, max(ap.scheduled_at) as last_at
    from public.appointments ap
    where ap.tenant_id = public.assert_current_tenant(p_tenant_id)
      and ap.customer_id = any(p_customer_ids)
    group by ap.customer_id
  ) a on a.customer_id = c.id
  left join (
    select cl.customer_id, max(cl.started_at) as last_at
    from public.calls cl
    where cl.tenant_id = public.assert_current_tenant(p_tenant_id)
      and cl.customer_id = any(p_customer_ids)
    group by cl.customer_id
  ) ca on ca.customer_id = c.id
  left join (
    select pmf.customer_id, count(*) as cnt
    from public.portal_match_feedback pmf
    where pmf.tenant_id = public.assert_current_tenant(p_tenant_id)
      and pmf.customer_id = any(p_customer_ids)
      and pmf.verdict = 'liked'
      and pmf.created_at >= now() - interval '30 days'
    group by pmf.customer_id
  ) pf on pf.customer_id = c.id
  left join (
    select o.customer_id, count(*) as cnt
    from public.offers o
    where o.tenant_id = public.assert_current_tenant(p_tenant_id)
      and o.customer_id = any(p_customer_ids)
      and o.status in ('draft', 'submitted', 'countered')
    group by o.customer_id
  ) o on o.customer_id = c.id
  left join (
    select d0.customer_id, count(*) as cnt
    from public.deals d0
    where d0.tenant_id = public.assert_current_tenant(p_tenant_id)
      and d0.customer_id = any(p_customer_ids)
      and d0.stage in ('new', 'qualified', 'negotiation')
    group by d0.customer_id
  ) dl on dl.customer_id = c.id
  where c.tenant_id = public.assert_current_tenant(p_tenant_id)
    and c.id = any(p_customer_ids)
    and c.deleted_at is null;
$$;

revoke all privileges on function public.customer_heat_signals(uuid, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.customer_heat_signals(uuid, uuid[])
  to authenticated, service_role;

create or replace function public.customer_lead_signals(
  p_tenant_id uuid,
  p_customer_ids uuid[]
)
returns table(
  customer_id uuid,
  active_demands int,
  comms int,
  appts int,
  calls int,
  last_activity timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id,
    coalesce(d.cnt, 0)::int,
    coalesce(m.cnt, 0)::int,
    coalesce(a.cnt, 0)::int,
    coalesce(ca.cnt, 0)::int,
    greatest(m.last_at, a.last_at, ca.last_at)
  from public.customers c
  left join (
    select cd.customer_id, count(*) as cnt
    from public.customer_demands cd
    where cd.tenant_id = public.assert_current_tenant(p_tenant_id)
      and cd.customer_id = any(p_customer_ids)
      and cd.status in ('new', 'active', 'matched')
    group by cd.customer_id
  ) d on d.customer_id = c.id
  left join (
    select cm.customer_id, count(*) as cnt, max(cm.created_at) as last_at
    from public.communications cm
    where cm.tenant_id = public.assert_current_tenant(p_tenant_id)
      and cm.customer_id = any(p_customer_ids)
    group by cm.customer_id
  ) m on m.customer_id = c.id
  left join (
    select ap.customer_id, count(*) as cnt, max(ap.scheduled_at) as last_at
    from public.appointments ap
    where ap.tenant_id = public.assert_current_tenant(p_tenant_id)
      and ap.customer_id = any(p_customer_ids)
    group by ap.customer_id
  ) a on a.customer_id = c.id
  left join (
    select cl.customer_id, count(*) as cnt, max(cl.started_at) as last_at
    from public.calls cl
    where cl.tenant_id = public.assert_current_tenant(p_tenant_id)
      and cl.customer_id = any(p_customer_ids)
    group by cl.customer_id
  ) ca on ca.customer_id = c.id
  where c.tenant_id = public.assert_current_tenant(p_tenant_id)
    and c.id = any(p_customer_ids)
    and c.deleted_at is null;
$$;

revoke all privileges on function public.customer_lead_signals(uuid, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.customer_lead_signals(uuid, uuid[])
  to authenticated, service_role;
