-- Danışman KPI paneli — 5 tablodan 5000'er satır çekip JS'te toplamak yerine
-- tek round-trip'te Postgres tarafında aggregate. current_tenant_id kapsamlı.
create or replace function public.advisor_kpis(p_tenant_id uuid, p_month_start timestamptz)
returns table(
  assigned_to    uuid,
  customer_count bigint,
  call_count     bigint,
  appoint_count  bigint,
  offer_count    bigint,
  deal_count     bigint,
  revenue        numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with cust as (
    select assigned_to, count(*)::bigint as c
    from public.customers
    where tenant_id = p_tenant_id and deleted_at is null and assigned_to is not null
    group by assigned_to
  ),
  cal as (
    select handled_by as uid, count(*)::bigint as c
    from public.calls
    where tenant_id = p_tenant_id and started_at >= p_month_start and handled_by is not null
    group by handled_by
  ),
  appt as (
    select assigned_to as uid, count(*)::bigint as c
    from public.appointments
    where tenant_id = p_tenant_id and scheduled_at >= p_month_start and assigned_to is not null
    group by assigned_to
  ),
  off as (
    select created_by as uid,
           count(*)::bigint as c,
           count(*) filter (where status = 'accepted')::bigint as accepted
    from public.offers
    where tenant_id = p_tenant_id and created_at >= p_month_start and created_by is not null
    group by created_by
  ),
  comm as (
    select d.assigned_to as uid, coalesce(sum(cm.gross_amount), 0)::numeric as rev
    from public.commissions cm
    join public.deals d on d.id = cm.deal_id
    where cm.tenant_id = p_tenant_id
      and cm.created_at >= p_month_start
      and cm.status in ('paid', 'collected')
      and d.assigned_to is not null
    group by d.assigned_to
  ),
  ids as (
    select assigned_to as uid from cust
    union select uid from cal
    union select uid from appt
    union select uid from off
    union select uid from comm
  )
  select
    ids.uid                              as assigned_to,
    coalesce(cust.c, 0)                  as customer_count,
    coalesce(cal.c, 0)                   as call_count,
    coalesce(appt.c, 0)                  as appoint_count,
    coalesce(off.c, 0)                   as offer_count,
    coalesce(off.accepted, 0)            as deal_count,
    coalesce(comm.rev, 0)                as revenue
  from ids
  left join cust on cust.assigned_to = ids.uid
  left join cal  on cal.uid = ids.uid
  left join appt on appt.uid = ids.uid
  left join off  on off.uid = ids.uid
  left join comm on comm.uid = ids.uid;
$$;

grant execute on function public.advisor_kpis(uuid, timestamptz) to authenticated, service_role;
