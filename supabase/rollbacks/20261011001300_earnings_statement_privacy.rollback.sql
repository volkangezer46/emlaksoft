-- Rollback: 20261011001300_earnings_statement_privacy
-- Komisyon/rapor toplulaştırmalarını önceki gövdelere (20261011001000 / 20261006000710) ve ekstre okuma politikalarını
-- önceki (20261011001200) hâline döndürür. Veri değişmez.
-- NOT: geri alma kazanç ve maaş gizliliğini YENİDEN AÇAR (danışman ofis toplamını/başkasının payını, muhasebe maaşa bağlı ekstre satırını görür).

create or replace function public.tenant_commission_aggregates(
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
  if v_tenant is null or not public.has_effective_permission('commissions', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Ornek veri kapsami (src/lib/sample-scope.ts includeSample ile ayni).
  select count(*) into v_real_customers from public.customers c
   where c.tenant_id = v_tenant and c.is_sample = false and c.deleted_at is null;
  select count(*) into v_real_properties from public.properties p
   where p.tenant_id = v_tenant and p.is_sample = false and p.deleted_at is null;
  v_include := (v_real_customers < v_threshold and v_real_properties < v_threshold);

  with bounds as (
    -- Ay siniri Istanbul yerel saatine gore (bkz. 20260802000340).
    select date_trunc('month', p_as_of at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul' as month_start
  ),
  scoped as (
    select c.* from public.commissions c
    where c.tenant_id = v_tenant and (v_include or c.is_sample = false)
  ),
  totals as (
    select
      coalesce(sum(c.gross_amount), 0) as total,
      coalesce(sum(c.gross_amount) filter (where c.status in ('paid', 'collected')), 0) as paid,
      count(*) as record_count
    from scoped c
  ),
  current_month as (
    select
      coalesce(sum(c.gross_amount), 0) as total,
      coalesce(sum(c.gross_amount) filter (where c.status in ('paid', 'collected')), 0) as paid,
      count(*) as record_count
    from scoped c, bounds b
    where c.created_at >= b.month_start
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
    left join scoped c
      on c.created_at >= m.month_start
     and c.created_at < m.month_start + interval '1 month'
    group by m.month_start
    order by m.month_start
  ),
  split_rows as (
    select
      nullif(s.item ->> 'profile_id', '')::uuid as profile_id,
      btrim(s.item ->> 'label') as label,
      coalesce((s.item ->> 'unresolved')::boolean, false) as unresolved,
      c.id,
      c.gross_amount *
        case
          when coalesce(s.item ->> 'rate', '') ~ '^[0-9]+([.][0-9]+)?$'
            then (s.item ->> 'rate')::numeric / 100
          else 0
        end as pay
    from scoped c
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(c.splits) = 'array' then c.splits else '[]'::jsonb end
    ) as s(item)
    where nullif(btrim(s.item ->> 'label'), '') is not null
  ),
  -- Taraf kimliği profile_id'dir (Konsey #0+#8): aynı etiketli iki kişi birleşmez; profil adı güncel adı gösterir.
  advisors as (
    select coalesce(max(p.full_name), max(r.label)) as label,
           r.profile_id,
           bool_or(r.unresolved) as unresolved,
           coalesce(sum(r.pay), 0) as pay,
           count(distinct r.id) as record_count
    from split_rows r
    left join public.profiles p on p.id = r.profile_id and p.tenant_id = v_tenant
    where r.pay > 0
    group by coalesce(r.profile_id::text, r.label), r.profile_id
    order by pay desc, 1
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
    'advisors', coalesce((select jsonb_agg(to_jsonb(a) order by a.pay desc, a.label) from advisors a), '[]'::jsonb),
    'sample_included', v_include
  ) into v_result
  from totals t cross join current_month cm;

  return v_result;
end;
$$;

create or replace function public.tenant_reporting_aggregates(
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
  if v_tenant is null or not public.has_effective_permission('reports', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Ornek veri kapsami (src/lib/sample-scope.ts includeSample ile ayni).
  select count(*) into v_real_customers from public.customers c
   where c.tenant_id = v_tenant and c.is_sample = false and c.deleted_at is null;
  select count(*) into v_real_properties from public.properties p
   where p.tenant_id = v_tenant and p.is_sample = false and p.deleted_at is null;
  v_include := (v_real_customers < v_threshold and v_real_properties < v_threshold);

  with bounds as (
    -- Ay siniri Istanbul yerel saatine gore - bkz. tenant_commission_aggregates.
    select
      date_trunc('month', p_as_of at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul' as month_start,
      date_trunc('month', p_as_of at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul' - interval '1 month' as prev_month_start,
      date_trunc('month', p_as_of at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul' - interval '11 months' as trend_start,
      p_as_of - interval '7 days' as seven_days_ago,
      p_as_of - interval '30 days' as thirty_days_ago
  ),
  summary as (
    select
      (select count(*) from public.customers c where c.tenant_id = v_tenant and c.deleted_at is null and (v_include or c.is_sample = false)) as customers,
      (select count(*) from public.customer_demands d where d.tenant_id = v_tenant and d.status in ('new','active','matched') and (v_include or d.is_sample = false)) as demands,
      (select count(*) from public.properties p where p.tenant_id = v_tenant and p.deleted_at is null and (v_include or p.is_sample = false)) as properties,
      (select count(*) from public.portal_listings p where p.tenant_id = v_tenant and p.status = 'live') as live_portals,
      (select count(*) from public.portal_listings p, bounds b where p.tenant_id = v_tenant and p.status = 'live' and (p.last_confirmed_at is null or p.last_confirmed_at < b.seven_days_ago)) as overdue_confirmations,
      (select coalesce(sum(c.gross_amount), 0) from public.commissions c, bounds b where c.tenant_id = v_tenant and c.created_at >= b.month_start and c.created_at < b.month_start + interval '1 month' and (v_include or c.is_sample = false)) as month_commission,
      (select coalesce(sum(l.estimated_lost_commission), 0) from public.listing_closures l, bounds b where l.tenant_id = v_tenant and l.created_at >= b.month_start and l.created_at < b.month_start + interval '1 month') as month_lost,
      (select coalesce(sum(l.estimated_lost_commission), 0) from public.listing_closures l, bounds b where l.tenant_id = v_tenant and l.created_at >= b.prev_month_start and l.created_at < b.month_start) as prev_month_lost,
      (select count(*) from public.customer_demands d, bounds b where d.tenant_id = v_tenant and d.created_at >= b.month_start and d.created_at < b.month_start + interval '1 month' and (v_include or d.is_sample = false)) as month_new_demands,
      (select count(*) from public.customer_demands d, bounds b where d.tenant_id = v_tenant and d.created_at >= b.prev_month_start and d.created_at < b.month_start and (v_include or d.is_sample = false)) as prev_month_new_demands,
      (select count(*) from public.listing_closures l, bounds b where l.tenant_id = v_tenant and l.created_at >= b.thirty_days_ago) as closures_30d,
      (select count(*) from public.appointments a, bounds b where a.tenant_id = v_tenant and a.scheduled_at >= b.seven_days_ago and a.scheduled_at <= p_as_of and (v_include or a.is_sample = false)) as appointments_7d,
      (select count(*) from public.calls c, bounds b where c.tenant_id = v_tenant and c.started_at >= b.seven_days_ago and c.started_at <= p_as_of and (v_include or c.is_sample = false)) as calls_7d
  ),
  customer_sources as (
    select coalesce(nullif(btrim(c.source), ''), 'Belirtilmedi') as source, count(*) as customer_count
    from public.customers c
    where c.tenant_id = v_tenant and c.deleted_at is null and (v_include or c.is_sample = false)
    group by 1
  ),
  lost_reasons as (
    select coalesce(nullif(btrim(d.loss_reason), ''), 'Belirtilmedi') as reason,
           count(*) as deal_count, coalesce(sum(d.deal_value), 0) as deal_value
    from public.deals d
    where d.tenant_id = v_tenant and d.stage = 'lost' and (v_include or d.is_sample = false)
    group by 1
  ),
  won_sources as (
    select coalesce(nullif(btrim(c.source), ''), 'Belirtilmedi') as source,
           count(*) as won_count, coalesce(sum(d.deal_value), 0) as won_value
    from public.deals d
    join public.customers c on c.id = d.customer_id and c.tenant_id = d.tenant_id
    where d.tenant_id = v_tenant and d.stage = 'won' and (v_include or d.is_sample = false)
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
      coalesce((select sum(c.gross_amount) from public.commissions c where c.tenant_id = v_tenant and c.created_at >= m.month_start and c.created_at < m.month_start + interval '1 month' and (v_include or c.is_sample = false)), 0) as income,
      coalesce((select sum(e.amount) from public.expenses e where e.tenant_id = v_tenant and e.expense_date >= m.month_start::date and e.expense_date < (m.month_start + interval '1 month')::date and (v_include or e.is_sample = false)), 0) as expense
    from month_axis m
  )
  select jsonb_build_object(
    'summary', to_jsonb(s),
    'customer_sources', coalesce((select jsonb_agg(to_jsonb(x) order by x.customer_count desc, x.source) from customer_sources x), '[]'::jsonb),
    'loss_reasons', coalesce((select jsonb_agg(to_jsonb(x) order by x.deal_count desc, x.deal_value desc, x.reason) from lost_reasons x), '[]'::jsonb),
    'roi', coalesce((select jsonb_agg(to_jsonb(x) order by x.won_value desc, x.won_count desc, x.customers desc, x.source) from roi x), '[]'::jsonb),
    'monthly', coalesce((select jsonb_agg(to_jsonb(x) order by x.month_start) from monthly x), '[]'::jsonb),
    'sample_included', v_include
  ) into v_result
  from summary s;

  return v_result;
end;
$$;

drop policy if exists finance_statement_imports_select on public.finance_statement_imports;
create policy finance_statement_imports_select on public.finance_statement_imports
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and exists (select 1 from public.finance_accounts a where a.id = finance_statement_imports.account_id and a.tenant_id = finance_statement_imports.tenant_id)
  );

drop policy if exists finance_statement_lines_select on public.finance_statement_lines;
create policy finance_statement_lines_select on public.finance_statement_lines
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and exists (select 1 from public.finance_accounts a where a.id = finance_statement_lines.account_id and a.tenant_id = finance_statement_lines.tenant_id)
  );

drop policy if exists finance_statement_mappings_select on public.finance_statement_mappings;
create policy finance_statement_mappings_select on public.finance_statement_mappings
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and exists (select 1 from public.finance_accounts a where a.id = finance_statement_mappings.account_id and a.tenant_id = finance_statement_mappings.tenant_id)
  );

notify pgrst, 'reload schema';
