-- 20261008001900 geri alma: 20261007000810 gövdesine döner.
create or replace function public.tenant_expense_aggregates(
  p_from date default null,
  p_to date default null,
  p_as_of timestamptz default now(),
  p_sample_threshold integer default 5
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_active_tenant_id();
  v_threshold integer := greatest(coalesce(p_sample_threshold, 5), 0);
  v_real_customers bigint;
  v_real_properties bigint;
  v_include boolean;
  v_result jsonb;
begin
  if v_tenant is null or not public.has_effective_permission('expenses', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Ornek veri kapsami (src/lib/sample-scope.ts includeSample ile ayni).
  select count(*) into v_real_customers from public.customers c
   where c.tenant_id = v_tenant and c.is_sample = false and c.deleted_at is null;
  select count(*) into v_real_properties from public.properties p
   where p.tenant_id = v_tenant and p.is_sample = false and p.deleted_at is null;
  v_include := (v_real_customers < v_threshold and v_real_properties < v_threshold);

  with bounds as (
    select date_trunc('month', p_as_of at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul' as month_start
  ),
  scoped as (
    -- ?from=/?to= tarih araligi — sayfadaki "Toplam gider"/"Kayit"/kategori kirilimi bu araliga saygilidir
    select e.*
    from public.expenses e
    where e.tenant_id = v_tenant
      and (v_include or e.is_sample = false)
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
    -- Son 6 ay trendi — ?from=/?to= filtresinden BAGIMSIZ (sayfadaki mevcut sozlesme)
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
          and (v_include or e.is_sample = false)
          and e.expense_date >= m.month_start::date
          and e.expense_date < (m.month_start + interval '1 month')::date
      ), 0) as total
    from month_axis m
  )
  select jsonb_build_object(
    'total', t.total,
    'record_count', t.record_count,
    'by_category', coalesce((select jsonb_agg(to_jsonb(bc) order by bc.total desc, bc.category) from by_category bc), '[]'::jsonb),
    'monthly', coalesce((select jsonb_agg(to_jsonb(m) order by m.month_start) from monthly m), '[]'::jsonb),
    'sample_included', v_include
  ) into v_result
  from totals t;

  return v_result;
end;
$$;

revoke all on function public.tenant_expense_aggregates(date, date, timestamptz, integer) from public, anon;
grant execute on function public.tenant_expense_aggregates(date, date, timestamptz, integer) to authenticated;

notify pgrst, 'reload schema';
