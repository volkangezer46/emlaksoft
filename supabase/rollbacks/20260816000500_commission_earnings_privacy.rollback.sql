-- Rollback: 20260816000500_commission_earnings_privacy
-- Eski (20260731000133) commissions_select ve advisor_kpis gövdesini geri yazar. Veri değişmez.
-- Dikkat: geri alındığında kazanç gizliliği yeniden yalnız uygulama katmanındadır.

alter policy commissions_select on public.commissions
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('commissions', 'view'))
);

create or replace function public.advisor_kpis(
  p_tenant_id uuid,
  p_month_start timestamptz
)
returns table(
  assigned_to uuid,
  customer_count bigint,
  call_count bigint,
  appoint_count bigint,
  offer_count bigint,
  deal_count bigint,
  revenue numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with cust as (
    select c.assigned_to, count(*)::bigint as c
    from public.customers c
    where c.tenant_id = public.assert_current_tenant(p_tenant_id)
      and c.deleted_at is null
      and c.assigned_to is not null
    group by c.assigned_to
  ),
  cal as (
    select c.handled_by as uid, count(*)::bigint as c
    from public.calls c
    where c.tenant_id = public.assert_current_tenant(p_tenant_id)
      and c.started_at >= p_month_start
      and c.handled_by is not null
    group by c.handled_by
  ),
  appt as (
    select a.assigned_to as uid, count(*)::bigint as c
    from public.appointments a
    where a.tenant_id = public.assert_current_tenant(p_tenant_id)
      and a.scheduled_at >= p_month_start
      and a.assigned_to is not null
    group by a.assigned_to
  ),
  off as (
    select o.created_by as uid,
           count(*)::bigint as c,
           count(*) filter (where o.status = 'accepted')::bigint as accepted
    from public.offers o
    where o.tenant_id = public.assert_current_tenant(p_tenant_id)
      and o.created_at >= p_month_start
      and o.created_by is not null
    group by o.created_by
  ),
  comm as (
    select d.assigned_to as uid, coalesce(sum(cm.gross_amount), 0)::numeric as rev
    from public.commissions cm
    join public.deals d on d.id = cm.deal_id
    where cm.tenant_id = public.assert_current_tenant(p_tenant_id)
      and cm.created_at >= p_month_start
      and cm.status in ('paid', 'collected')
      and d.assigned_to is not null
    group by d.assigned_to
  ),
  ids as (
    select cust.assigned_to as uid from cust
    union select cal.uid from cal
    union select appt.uid from appt
    union select off.uid from off
    union select comm.uid from comm
  )
  select
    ids.uid as assigned_to,
    coalesce(cust.c, 0) as customer_count,
    coalesce(cal.c, 0) as call_count,
    coalesce(appt.c, 0) as appoint_count,
    coalesce(off.c, 0) as offer_count,
    coalesce(off.accepted, 0) as deal_count,
    coalesce(comm.rev, 0) as revenue
  from ids
  left join cust on cust.assigned_to = ids.uid
  left join cal on cal.uid = ids.uid
  left join appt on appt.uid = ids.uid
  left join off on off.uid = ids.uid
  left join comm on comm.uid = ids.uid;
$$;

revoke all privileges on function public.advisor_kpis(uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.advisor_kpis(uuid, timestamptz)
  to authenticated, service_role;

drop function if exists public.can_view_commission_earnings(uuid, uuid, uuid);
