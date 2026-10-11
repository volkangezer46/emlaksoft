-- Rollback: 20261011001000_commission_split_profile
-- Tetikleyicileri, fonksiyonları ve eklenen sütun/indeksi kaldırır. commissions.splits jsonb'ye eklenen
-- profile_id/kind/unresolved anahtarları zararsızdır ve kalır (okuyucu bilinmeyen anahtarı yok sayar).
-- commission_splits satırları kalır (tablo 20260816000200'e aittir); yalnız position/unresolved sütunları düşer.
drop trigger if exists trg_commissions_splits_sync on public.commissions;
drop trigger if exists trg_commissions_splits_normalize on public.commissions;
drop function if exists public.commissions_splits_sync_trg();
drop function if exists public.commissions_splits_normalize_trg();
drop function if exists public.commission_normalize_splits(uuid, uuid, numeric, jsonb);
drop index if exists public.uq_commission_splits_position;
alter table public.commission_splits drop column if exists unresolved;
alter table public.commission_splits drop column if exists position;

-- tenant_commission_aggregates önceki gövde (20261006000710):
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
      btrim(s.item ->> 'label') as label,
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
    'advisors', coalesce((select jsonb_agg(to_jsonb(a) order by a.pay desc, a.label) from advisors a), '[]'::jsonb),
    'sample_included', v_include
  ) into v_result
  from totals t cross join current_month cm;

  return v_result;
end;
$$;

revoke all on function public.tenant_commission_aggregates(timestamptz, integer) from public, anon;
grant execute on function public.tenant_commission_aggregates(timestamptz, integer) to authenticated;
