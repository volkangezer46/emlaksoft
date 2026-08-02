-- Exact, bounded reporting aggregates.
-- KPI values are computed in PostgreSQL over the full authorized scope; raw
-- row limits remain an application concern only for recent-item lists.

create index if not exists idx_customers_tenant_source_active
  on public.customers (tenant_id, source)
  where deleted_at is null;

create index if not exists idx_tenants_created_status_plan
  on public.tenants (created_at desc, status, plan);

create index if not exists idx_subscriptions_status_created
  on public.subscriptions (status, created_at);

create index if not exists idx_support_tickets_created_status_priority
  on public.support_tickets (created_at desc, status, priority);

create index if not exists idx_audit_logs_created_action_tenant
  on public.audit_logs (created_at desc, action, tenant_id)
  where tenant_id is not null;

create or replace function public.tenant_commission_aggregates(
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_active_tenant_id();
  v_result jsonb;
begin
  if v_tenant is null or not public.has_effective_permission('commissions', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with bounds as (
    -- Ay sınırı İstanbul yerel saatine göre (varsayılan UTC değil) — ayın ilk
    -- birkaç saatinde (İstanbul 00:00-02:59) kaydedilen komisyonlar yanlış aya
    -- düşmesin diye (bkz. support_ticket_metrics_v2'deki aynı desen).
    select date_trunc('month', p_as_of at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul' as month_start
  ),
  totals as (
    select
      coalesce(sum(c.gross_amount), 0) as total,
      coalesce(sum(c.gross_amount) filter (where c.status in ('paid', 'collected')), 0) as paid,
      count(*) as record_count
    from public.commissions c
    where c.tenant_id = v_tenant
  ),
  current_month as (
    select
      coalesce(sum(c.gross_amount), 0) as total,
      coalesce(sum(c.gross_amount) filter (where c.status in ('paid', 'collected')), 0) as paid,
      count(*) as record_count
    from public.commissions c, bounds b
    where c.tenant_id = v_tenant
      and c.created_at >= b.month_start
      and c.created_at < b.month_start + interval '1 month'
  ),
  month_axis as (
    select generate_series(
      date_trunc('month', p_as_of at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul' - interval '5 months',
      date_trunc('month', p_as_of at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul',
      interval '1 month'
    ) as month_start
  ),
  monthly as (
    select
      m.month_start,
      coalesce(sum(c.gross_amount), 0) as accrued,
      coalesce(sum(c.gross_amount) filter (where c.status in ('paid', 'collected')), 0) as paid
    from month_axis m
    left join public.commissions c
      on c.tenant_id = v_tenant
     and c.created_at >= m.month_start
     and c.created_at < m.month_start + interval '1 month'
    group by m.month_start
    order by m.month_start
  ),
  split_rows as (
    select
      btrim(s.item ->> 'label') as label,
      c.id,
      c.gross_amount *
        case
          when coalesce(s.item ->> 'rate', '') ~ '^[0-9]+([.][0-9]+)?$'
            then (s.item ->> 'rate')::numeric / 100
          else 0
        end as pay
    from public.commissions c
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(c.splits) = 'array' then c.splits else '[]'::jsonb end
    ) as s(item)
    where c.tenant_id = v_tenant
      and nullif(btrim(s.item ->> 'label'), '') is not null
  ),
  advisors as (
    select label, coalesce(sum(pay), 0) as pay, count(distinct id) as record_count
    from split_rows
    where pay > 0
    group by label
    order by pay desc, label
    limit 8
  )
  select jsonb_build_object(
    'total', t.total,
    'paid', t.paid,
    'pending', t.total - t.paid,
    'record_count', t.record_count,
    'month_total', cm.total,
    'month_paid', cm.paid,
    'month_pending', cm.total - cm.paid,
    'month_record_count', cm.record_count,
    'monthly', coalesce((select jsonb_agg(to_jsonb(m) order by m.month_start) from monthly m), '[]'::jsonb),
    'advisors', coalesce((select jsonb_agg(to_jsonb(a) order by a.pay desc, a.label) from advisors a), '[]'::jsonb)
  ) into v_result
  from totals t cross join current_month cm;

  return v_result;
end;
$$;

revoke all on function public.tenant_commission_aggregates(timestamptz) from public, anon;
grant execute on function public.tenant_commission_aggregates(timestamptz) to authenticated;

create or replace function public.tenant_reporting_aggregates(
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_active_tenant_id();
  v_result jsonb;
begin
  if v_tenant is null or not public.has_effective_permission('reports', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with bounds as (
    -- Ay sınırı İstanbul yerel saatine göre — bkz. tenant_commission_aggregates.
    select
      date_trunc('month', p_as_of at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul' as month_start,
      date_trunc('month', p_as_of at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul' - interval '1 month' as prev_month_start,
      date_trunc('month', p_as_of at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul' - interval '11 months' as trend_start,
      p_as_of - interval '7 days' as seven_days_ago,
      p_as_of - interval '30 days' as thirty_days_ago
  ),
  summary as (
    select
      (select count(*) from public.customers c where c.tenant_id = v_tenant and c.deleted_at is null) as customers,
      (select count(*) from public.customer_demands d where d.tenant_id = v_tenant and d.status in ('new','active','matched')) as demands,
      (select count(*) from public.properties p where p.tenant_id = v_tenant and p.deleted_at is null) as properties,
      (select count(*) from public.portal_listings p where p.tenant_id = v_tenant and p.status = 'live') as live_portals,
      (select count(*) from public.portal_listings p, bounds b where p.tenant_id = v_tenant and p.status = 'live' and (p.last_confirmed_at is null or p.last_confirmed_at < b.seven_days_ago)) as overdue_confirmations,
      (select coalesce(sum(c.gross_amount), 0) from public.commissions c, bounds b where c.tenant_id = v_tenant and c.created_at >= b.month_start and c.created_at < b.month_start + interval '1 month') as month_commission,
      (select coalesce(sum(l.estimated_lost_commission), 0) from public.listing_closures l, bounds b where l.tenant_id = v_tenant and l.created_at >= b.month_start and l.created_at < b.month_start + interval '1 month') as month_lost,
      (select coalesce(sum(l.estimated_lost_commission), 0) from public.listing_closures l, bounds b where l.tenant_id = v_tenant and l.created_at >= b.prev_month_start and l.created_at < b.month_start) as prev_month_lost,
      (select count(*) from public.customer_demands d, bounds b where d.tenant_id = v_tenant and d.created_at >= b.month_start and d.created_at < b.month_start + interval '1 month') as month_new_demands,
      (select count(*) from public.customer_demands d, bounds b where d.tenant_id = v_tenant and d.created_at >= b.prev_month_start and d.created_at < b.month_start) as prev_month_new_demands,
      (select count(*) from public.listing_closures l, bounds b where l.tenant_id = v_tenant and l.created_at >= b.thirty_days_ago) as closures_30d,
      (select count(*) from public.appointments a, bounds b where a.tenant_id = v_tenant and a.scheduled_at >= b.seven_days_ago and a.scheduled_at <= p_as_of) as appointments_7d,
      (select count(*) from public.calls c, bounds b where c.tenant_id = v_tenant and c.started_at >= b.seven_days_ago and c.started_at <= p_as_of) as calls_7d
  ),
  customer_sources as (
    select coalesce(nullif(btrim(c.source), ''), 'Belirtilmedi') as source, count(*) as customer_count
    from public.customers c
    where c.tenant_id = v_tenant and c.deleted_at is null
    group by 1
  ),
  lost_reasons as (
    select coalesce(nullif(btrim(d.loss_reason), ''), 'Belirtilmedi') as reason,
           count(*) as deal_count, coalesce(sum(d.deal_value), 0) as deal_value
    from public.deals d
    where d.tenant_id = v_tenant and d.stage = 'lost'
    group by 1
  ),
  won_sources as (
    select coalesce(nullif(btrim(c.source), ''), 'Belirtilmedi') as source,
           count(*) as won_count, coalesce(sum(d.deal_value), 0) as won_value
    from public.deals d
    join public.customers c on c.id = d.customer_id and c.tenant_id = d.tenant_id
    where d.tenant_id = v_tenant and d.stage = 'won'
    group by 1
  ),
  roi as (
    select coalesce(cs.source, ws.source) as source,
           coalesce(cs.customer_count, 0) as customers,
           coalesce(ws.won_count, 0) as won_count,
           coalesce(ws.won_value, 0) as won_value
    from customer_sources cs
    full join won_sources ws using (source)
  ),
  month_axis as (
    select generate_series(
      date_trunc('month', p_as_of at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul' - interval '11 months',
      date_trunc('month', p_as_of at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul',
      interval '1 month'
    ) as month_start
  ),
  monthly as (
    select m.month_start,
      coalesce((select sum(c.gross_amount) from public.commissions c where c.tenant_id = v_tenant and c.created_at >= m.month_start and c.created_at < m.month_start + interval '1 month'), 0) as income,
      coalesce((select sum(e.amount) from public.expenses e where e.tenant_id = v_tenant and e.expense_date >= m.month_start::date and e.expense_date < (m.month_start + interval '1 month')::date), 0) as expense
    from month_axis m
  )
  select jsonb_build_object(
    'summary', to_jsonb(s),
    'customer_sources', coalesce((select jsonb_agg(to_jsonb(x) order by x.customer_count desc, x.source) from customer_sources x), '[]'::jsonb),
    'loss_reasons', coalesce((select jsonb_agg(to_jsonb(x) order by x.deal_count desc, x.deal_value desc, x.reason) from lost_reasons x), '[]'::jsonb),
    'roi', coalesce((select jsonb_agg(to_jsonb(x) order by x.won_value desc, x.won_count desc, x.customers desc, x.source) from roi x), '[]'::jsonb),
    'monthly', coalesce((select jsonb_agg(to_jsonb(x) order by x.month_start) from monthly x), '[]'::jsonb)
  ) into v_result
  from summary s;

  return v_result;
end;
$$;

revoke all on function public.tenant_reporting_aggregates(timestamptz) from public, anon;
grant execute on function public.tenant_reporting_aggregates(timestamptz) to authenticated;

create or replace function public.platform_reporting_aggregates(
  p_from date default null,
  p_to date default null,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with tenant_scope as (
    select t.* from public.tenants t
    where (p_from is null or t.created_at >= p_from::timestamptz)
      and (p_to is null or t.created_at < (p_to + 1)::timestamptz)
  ),
  subscription_scope as (
    select s.* from public.subscriptions s
    where (p_from is null or s.created_at >= p_from::timestamptz)
      and (p_to is null or s.created_at < (p_to + 1)::timestamptz)
  ),
  ticket_scope as (
    select t.* from public.support_tickets t
    where (p_from is null or t.created_at >= p_from::timestamptz)
      and (p_to is null or t.created_at < (p_to + 1)::timestamptz)
  ),
  summary as (
    select
      (select count(*) from tenant_scope) as tenant_count,
      (select count(*) from tenant_scope where status = 'active') as active_count,
      (select count(*) from tenant_scope where status = 'trial') as trial_count,
      (select count(*) from tenant_scope where status in ('past_due','suspended')) as risk_count,
      (select count(*) from tenant_scope where status = 'cancelled') as cancelled_count,
      (select count(*) from public.tenants where status = 'trial' and trial_ends_at > p_as_of and trial_ends_at < p_as_of + interval '7 days') as trials_ending_7d,
      (select count(*) from public.profiles) as member_count,
      (select count(*) from ticket_scope) as ticket_count,
      (select count(*) from ticket_scope where status in ('open','in_progress','waiting')) as open_ticket_count,
      (select count(*) from ticket_scope where priority = 'urgent' and status not in ('resolved','closed')) as urgent_ticket_count,
      (select count(*) from ticket_scope where status in ('resolved','closed')) as resolved_ticket_count,
      (select count(*) from public.demo_requests where status = 'new') as new_demo_count,
      -- subscriptions.amount_try is normalized to the canonical monthly/MRR
      -- amount by the registration and billing fulfillment transactions.
      (select coalesce(sum(amount_try), 0) from subscription_scope where status = 'active') as subscription_mrr
  ),
  plan_axis(plan) as (
    values ('advisor'::text), ('office'::text), ('professional'::text), ('enterprise'::text)
  ),
  plan_stats as (
    select p.plan,
      (select count(*) from tenant_scope t where t.plan = p.plan) as tenant_count,
      (select count(*) from tenant_scope t where t.plan = p.plan and t.status = 'active') as active_count,
      (select count(*) from subscription_scope s where s.plan = p.plan and s.status = 'active') as subscription_count,
      (select coalesce(sum(s.amount_try), 0) from subscription_scope s where s.plan = p.plan and s.status = 'active') as subscription_mrr
    from plan_axis p
  ),
  status_axis(status) as (
    values ('trial'::text), ('active'::text), ('past_due'::text), ('suspended'::text), ('cancelled'::text)
  ),
  status_stats as (
    select s.status, (select count(*) from tenant_scope t where t.status = s.status) as tenant_count
    from status_axis s
  ),
  month_axis as (
    select generate_series(
      date_trunc('month', p_as_of) - interval '11 months',
      date_trunc('month', p_as_of),
      interval '1 month'
    ) as month_start
  ),
  mrr_trend as (
    select m.month_start,
      coalesce((select sum(s.amount_try)
                from subscription_scope s
                where s.status = 'active' and s.created_at < m.month_start + interval '1 month'), 0) as subscription_mrr,
      (select count(*) from tenant_scope t where t.status = 'active' and t.plan = 'advisor' and t.created_at < m.month_start + interval '1 month') as advisor_count,
      (select count(*) from subscription_scope s where s.status = 'active' and s.plan = 'advisor' and s.created_at < m.month_start + interval '1 month') as advisor_subscription_count,
      (select count(*) from tenant_scope t where t.status = 'active' and t.plan = 'office' and t.created_at < m.month_start + interval '1 month') as office_count,
      (select count(*) from subscription_scope s where s.status = 'active' and s.plan = 'office' and s.created_at < m.month_start + interval '1 month') as office_subscription_count,
      (select count(*) from tenant_scope t where t.status = 'active' and t.plan = 'professional' and t.created_at < m.month_start + interval '1 month') as professional_count,
      (select count(*) from subscription_scope s where s.status = 'active' and s.plan = 'professional' and s.created_at < m.month_start + interval '1 month') as professional_subscription_count,
      (select count(*) from tenant_scope t where t.status = 'active' and t.plan = 'enterprise' and t.created_at < m.month_start + interval '1 month') as enterprise_count,
      (select count(*) from subscription_scope s where s.status = 'active' and s.plan = 'enterprise' and s.created_at < m.month_start + interval '1 month') as enterprise_subscription_count
    from month_axis m
  ),
  week_axis as (
    select generate_series(
      date_trunc('week', p_as_of) - interval '7 weeks',
      date_trunc('week', p_as_of),
      interval '1 week'
    ) as week_start
  ),
  weekly as (
    select w.week_start,
      (select count(*) from public.tenants t where t.created_at >= w.week_start and t.created_at < w.week_start + interval '1 week') as tenants,
      (select count(*) from public.subscriptions s where s.status = 'active' and s.created_at >= w.week_start and s.created_at < w.week_start + interval '1 week') as active_subscriptions,
      (select count(*) from public.tenants t where t.status = 'trial' and t.created_at >= w.week_start and t.created_at < w.week_start + interval '1 week') as trials,
      (select count(*) from public.support_tickets t where t.created_at >= w.week_start and t.created_at < w.week_start + interval '1 week') as tickets
    from week_axis w
  ),
  top_candidates as (
    select id, name, plan, created_at,
      row_number() over (partition by plan order by created_at desc, id) as plan_rank
    from tenant_scope
    where status = 'active'
  ),
  adoption_labeled as (
    select distinct a.tenant_id,
      case split_part(a.action, '.', 1)
        when 'customer' then 'customers' when 'customer_file' then 'customers' when 'kvkk' then 'customers' when 'call' then 'customers'
        when 'lead' then 'demands' when 'demand' then 'demands' when 'match' then 'demands'
        when 'property' then 'properties' when 'property_media' then 'properties' when 'share' then 'properties' when 'portal' then 'properties'
        when 'deal' then 'deals' when 'offer' then 'deals'
        when 'task' then 'tasks' when 'appointment' then 'appointments'
        when 'commission' then 'commissions' when 'payment_link' then 'commissions'
        when 'contract' then 'contracts' when 'rental' then 'rentals'
        when 'campaign' then 'campaigns' when 'iys' then 'campaigns'
        when 'automation' then 'automations' when 'workflow' then 'automations'
        when 'valuation' then 'valuations'
        when 'project' then 'projects' when 'project_unit' then 'projects' when 'unit_payment' then 'projects'
        when 'network' then 'network'
        else null
      end as module
    from public.audit_logs a
    where a.tenant_id is not null and a.created_at >= p_as_of - interval '30 days'
  ),
  adoption as (
    select module, count(*) as offices
    from adoption_labeled
    where module is not null
    group by module
  )
  select jsonb_build_object(
    'summary', to_jsonb(s),
    'plan_stats', coalesce((select jsonb_agg(to_jsonb(x) order by x.plan) from plan_stats x), '[]'::jsonb),
    'status_stats', coalesce((select jsonb_agg(to_jsonb(x) order by x.status) from status_stats x), '[]'::jsonb),
    'mrr_trend', coalesce((select jsonb_agg(to_jsonb(x) order by x.month_start) from mrr_trend x), '[]'::jsonb),
    'weekly', coalesce((select jsonb_agg(to_jsonb(x) order by x.week_start) from weekly x), '[]'::jsonb),
    'top_tenants', coalesce((select jsonb_agg(to_jsonb(x) order by x.plan, x.created_at desc) from top_candidates x where x.plan_rank <= 6), '[]'::jsonb),
    'adoption', coalesce((select jsonb_agg(to_jsonb(x) order by x.module) from adoption x), '[]'::jsonb),
    'all_tenant_count', (select count(*) from public.tenants)
  ) into v_result
  from summary s;

  return v_result;
end;
$$;

revoke all on function public.platform_reporting_aggregates(date, date, timestamptz) from public, anon, authenticated;
grant execute on function public.platform_reporting_aggregates(date, date, timestamptz) to service_role;

notify pgrst, 'reload schema';
