-- Giderler aylık trend düzeltmesi (görsel QA bulgusu, 2026-10-08).
--
-- NEDEN: tenant_expense_aggregates ay eksenini İstanbul gece yarısı SAAT DAMGASI olarak üretip generate_series ile ay ay
--   ilerletiyordu; UTC oturumunda `month_start::date` bir önceki güne düşüyor, etiketler "May May Tem Tem…" kayıyor ve
--   ayın 1'indeki giderler önceki aya yazılıyordu.
-- NE: ay ekseni doğrudan TARİH (İstanbul takvim ayı başı, YYYY-MM-01); toplamlar tarih aralığıyla. İmza, yetki, örnek veri
--   kapsamı ve dönüş biçimi aynı (month_start artık "YYYY-MM-01" metni; istemci İstanbul saat diliminde biçimliyor).
-- GERI ALMA: rollbacks/20261008001900_expense_trend_month_axis.rollback.sql (20261007000810 gövdesine döner).

set local lock_timeout = '5s';

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
    -- İstanbul takvim ayı başlangıcı TARİH olarak (saat damgası değil): UTC oturumunda ay ilerletme kayması olmaz.
    select (date_trunc('month', p_as_of at time zone 'Europe/Istanbul'))::date as month_start
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
    select ((select month_start from bounds) - make_interval(months => k))::date as month_start
    from generate_series(0, 5) as k
  ),
  monthly as (
    select m.month_start,
      coalesce((
        select sum(e.amount) from public.expenses e
        where e.tenant_id = v_tenant
          and (v_include or e.is_sample = false)
          and e.expense_date >= m.month_start
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
