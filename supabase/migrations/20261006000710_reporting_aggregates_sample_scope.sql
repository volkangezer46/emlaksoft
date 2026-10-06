-- MIGRATION 20261006000710_reporting_aggregates_sample_scope.sql (PB45)
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261006000710_reporting_aggregates_sample_scope.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261006000710_reporting_aggregates_sample_scope.rollback.sql (20260802000340 govdeleri aynen).
--
-- NEDEN: Raporlar (/app/raporlar), Komisyon (/app/komisyon) ve ana ekran komisyon ozeti SQL toplulastirmalarindan
--   beslenir (tenant_reporting_aggregates / tenant_commission_aggregates, 20260802000340). Bu iki fonksiyon is_sample
--   SUZMUYORDU: ofis gercek kullanima gectikten sonra da ornek (demo) komisyon/musteri/anlasma tutarlari toplamlara
--   karisiyordu. Diger KPI yuzeyleri (ana ekran snapshot RPC'leri 20261006000410, src/lib/sample-scope.ts) esik kuralini
--   uyguluyor; bu dosya iki fonksiyonu AYNI kurala baglar.
--
-- KURAL (src/lib/sample-scope.ts includeSample ile BIREBIR): ofiste gercek (is_sample = false, silinmemis) musteri VE
--   portfoy sayisi esigin ALTINDAYSA ornek kayitlar dahil, degilse dislanir. Esik parametredir: p_sample_threshold
--   (varsayilan 5 = SAMPLE_KPI_THRESHOLD; null -> 5, negatif -> 0 = her zaman dislanir). Karar donuste
--   'sample_included' olarak yer alir (UI etiketi buna bakar). Sozlesme testi varsayilanin TS sabitiyle esitligini dogrular
--   (src/lib/reporting/reporting-sample-scope-contract.test.ts).
--
-- IMZA: (timestamptz) -> (timestamptz, integer default 5). Iki varsayilanli overload yalniz p_as_of ile cagrida belirsiz
--   olacagi icin eski imza DUSURULUR ve yenisi olusturulur (ayni transaction; aradaki pencerede cagri yok). Mevcut cagiranlar
--   ({ p_as_of }) degismeden calisir. Yetki/tenant kapisi, sonuc anahtarlari ve hesaplar AYNEN korunur; yalniz is_sample
--   kosulu eklenir. Kapsam: is_sample tasiyan tablolar (customers, properties, customer_demands, appointments, deals,
--   commissions, calls, expenses). portal_listings / listing_closures bayrak tasimaz (ornek set bu tablolara yazmaz).
-- BAGIMLILIK: 20260802000340 (fonksiyonlar), is_sample sutunlari 20260726000086/096 + 20260816001600 (hepsi CANLIDA).

set local lock_timeout = '5s';

do $$
declare
  t text;
begin
  foreach t in array array['customers','properties','customer_demands','appointments','deals','commissions','calls','expenses']
  loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'is_sample'
    ) then
      raise exception '20261006000710: %.is_sample yok; once 20260726000086/096 ve 20260816001600 uygulanmali.', t;
    end if;
  end loop;
  if to_regprocedure('public.current_active_tenant_id()') is null
     or to_regprocedure('public.has_effective_permission(text, text)') is null then
    raise exception '20261006000710: current_active_tenant_id / has_effective_permission yok.';
  end if;
end
$$;

drop function if exists public.tenant_commission_aggregates(timestamptz);
drop function if exists public.tenant_reporting_aggregates(timestamptz);

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

revoke all on function public.tenant_reporting_aggregates(timestamptz, integer) from public, anon;
grant execute on function public.tenant_reporting_aggregates(timestamptz, integer) to authenticated;

notify pgrst, 'reload schema';

-- DOGRULAMA (salt-okunur, uygulamadan SONRA):
-- select p.proname, pg_get_function_identity_arguments(p.oid) from pg_catalog.pg_proc p
-- join pg_catalog.pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname in ('tenant_commission_aggregates', 'tenant_reporting_aggregates');
-- BEKLENEN: her biri tek satir, (p_as_of timestamp with time zone, p_sample_threshold integer).
