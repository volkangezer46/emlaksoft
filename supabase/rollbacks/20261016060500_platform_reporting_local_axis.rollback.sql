-- ROLLBACK 20261016060500_platform_reporting_local_axis.sql
-- platform_reporting_aggregates 20260802000340_reporting_aggregates.sql govdesine BIREBIR doner (canlida 2026-10-16 itibariyla
-- uygulanan govdeyle ayni; ic ofis suzgeci, yerel eksen ve anlik goruntu tabanli mrr_trend kalkar). Imza ve ACL ayni.
-- Bu dosya 20261016060400 geri alinmadan ONCE uygulanir. Idempotent: create or replace + revoke/grant.
set local lock_timeout = '5s';

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
