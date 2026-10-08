-- Rollback: 20261007000810_expense_aggregates_sample_scope
-- tenant_expense_aggregates(date, date, timestamptz, integer) duser; 20260802000440 govdesi (3 arg) aynen geri gelir.
-- Geri almada kod (giderler/page.tsx) p_sample_threshold gondermeye devam ederse PostgREST imza bulamaz:
-- once kod eski cagriya (parametresiz) donmelidir.

set local lock_timeout = '5s';

drop function if exists public.tenant_expense_aggregates(date, date, timestamptz, integer);

create or replace function public.tenant_expense_aggregates(
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
  v_tenant uuid := public.current_active_tenant_id();
  v_result jsonb;
begin
  if v_tenant is null or not public.has_effective_permission('expenses', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with bounds as (
    select date_trunc('month', p_as_of at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul' as month_start
  ),
  scoped as (
    select e.*
    from public.expenses e
    where e.tenant_id = v_tenant
      and (p_from is null or e.expense_date >= p_from)
      and (p_to is null or e.expense_date <= p_to)
  ),
  totals as (
    select coalesce(sum(amount), 0) as total, count(*) as record_count
    from scoped
  ),
  by_category as (
    select category, coalesce(sum(amount), 0) as total
    from scoped
    group by category
  ),
  month_axis as (
    select generate_series(
      (select month_start from bounds) - interval '5 months',
      (select month_start from bounds),
      interval '1 month'
    ) as month_start
  ),
  monthly as (
    select m.month_start,
      coalesce((
        select sum(e.amount) from public.expenses e
        where e.tenant_id = v_tenant
          and e.expense_date >= m.month_start::date
          and e.expense_date < (m.month_start + interval '1 month')::date
      ), 0) as total
    from month_axis m
  )
  select jsonb_build_object(
    'total', t.total,
    'record_count', t.record_count,
    'by_category', coalesce((select jsonb_agg(to_jsonb(bc) order by bc.total desc, bc.category) from by_category bc), '[]'::jsonb),
    'monthly', coalesce((select jsonb_agg(to_jsonb(m) order by m.month_start) from monthly m), '[]'::jsonb)
  ) into v_result
  from totals t;

  return v_result;
end;
$$;

revoke all on function public.tenant_expense_aggregates(date, date, timestamptz) from public, anon;
grant execute on function public.tenant_expense_aggregates(date, date, timestamptz) to authenticated;

notify pgrst, 'reload schema';
