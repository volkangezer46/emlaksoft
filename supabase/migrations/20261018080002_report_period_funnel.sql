-- MIGRATION 20261018080002_report_period_funnel.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI uygular.
-- Geri alma: supabase/rollbacks/20261018080002_report_period_funnel.rollback.sql
-- BAGIMLILIK: 20261018080000 (deals.closed_at, report_sample_included, report_scope_member_ids), 20261016100000 (kapsam RLS'i),
--   20261008000700 (expenses.portal_key).
--
-- OA1: Raporlar genel bakista donem secici + sube/takim/danisman kapsami.
--   report_period_overview(p_from, p_to, p_branch, p_team, p_profile): donem ve AYNI UZUNLUKTA onceki donem icin akis metrikleri
--   (yeni musteri/talep/portfoy, randevu, cagri, teklif, kazanilan/kaybedilen anlasma ve tutari, komisyon) + donemin kaynak
--   dagilimi, kayip nedenleri ve kaynak ROI'si. Stok metrikler (acik talep, canli portal, gecikmis teyit, ofis skoru) eski
--   tenant_reporting_aggregates'ta kalir (degismez).
-- OA2 / arastirma 2: Satis hunisi. report_sales_funnel(...): donemde gelen musteri KOHORTU -> randevu -> teklif -> kazanilan anlasma
--   -> komisyon; kaynak ve danisman kirilimli + kaynak maliyeti (expenses: portal_key -> 'portal_<anahtar>', aksi halde kategori =
--   kaynak degeri) ve kaynaga baglanmamis pazarlama gideri.
-- GUVENLIK: ikisi de SECURITY INVOKER: cagiranin RLS'i (kiraci + SK10 kayit kapsami: takim lideri yalniz takimini, danisman yalniz
--   kendini gorur) aynen uygulanir; parametreler yalniz DARALTIR. Ek kapilar: reports:view zorunlu; komisyon tutarlari yalniz
--   earnings_all:view ile, gider tutarlari yalniz expenses:view ile doner (aksi halde null).
-- ETKI: ek (yalniz yeni fonksiyonlar). Idempotent.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('public.report_scope_member_ids(uuid,uuid,uuid)') is null
     or pg_catalog.to_regprocedure('public.report_sample_included(integer)') is null then
    raise exception '20261018080002: 20261018080000 once uygulanmali.';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'expenses' and column_name = 'portal_key') then
    raise exception '20261018080002: expenses.portal_key yok (20261008000700 once uygulanmali).';
  end if;
end $$;

create or replace function public.report_period_overview(
  p_from date,
  p_to date,
  p_branch uuid default null,
  p_team uuid default null,
  p_profile uuid default null,
  p_sample_threshold integer default 5
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_active_tenant_id();
  v_from timestamptz;
  v_to timestamptz;
  v_prev_from timestamptz;
  v_prev_from_date date;
  v_ids uuid[];
  v_include boolean;
  v_earn boolean;
  v_result jsonb;
begin
  if v_tenant is null or not public.has_effective_permission('reports', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 1100 then
    raise exception 'invalid period' using errcode = '22023';
  end if;
  v_prev_from_date := p_from - ((p_to - p_from) + 1);
  v_from := p_from::timestamp at time zone 'Europe/Istanbul';
  v_to := (p_to + 1)::timestamp at time zone 'Europe/Istanbul';
  v_prev_from := v_prev_from_date::timestamp at time zone 'Europe/Istanbul';
  v_ids := public.report_scope_member_ids(p_branch, p_team, p_profile);
  v_include := public.report_sample_included(p_sample_threshold);
  v_earn := public.has_effective_permission('earnings_all', 'view');

  with
  cust as (
    select c.id, c.created_at, coalesce(nullif(btrim(c.source), ''), 'Belirtilmedi') as source
    from public.customers c
    where c.tenant_id = v_tenant and c.deleted_at is null and (v_include or c.is_sample = false)
      and (v_ids is null or c.assigned_to = any (v_ids))
      and c.created_at >= v_prev_from and c.created_at < v_to
  ),
  dem as (
    select d.created_at
    from public.customer_demands d
    join public.customers c on c.id = d.customer_id and c.tenant_id = d.tenant_id
    where d.tenant_id = v_tenant and (v_include or d.is_sample = false)
      and (v_ids is null or c.assigned_to = any (v_ids))
      and d.created_at >= v_prev_from and d.created_at < v_to
  ),
  props as (
    select p.created_at from public.properties p
    where p.tenant_id = v_tenant and p.deleted_at is null and (v_include or p.is_sample = false)
      and (v_ids is null or p.assigned_to = any (v_ids))
      and p.created_at >= v_prev_from and p.created_at < v_to
  ),
  appts as (
    select a.scheduled_at as at from public.appointments a
    where a.tenant_id = v_tenant and a.status <> 'cancelled' and (v_include or a.is_sample = false)
      and (v_ids is null or a.assigned_to = any (v_ids))
      and a.scheduled_at >= v_prev_from and a.scheduled_at < least(v_to, now())
  ),
  calls_ as (
    select c.started_at as at from public.calls c
    where c.tenant_id = v_tenant and (v_include or c.is_sample = false)
      and (v_ids is null or c.handled_by = any (v_ids))
      and c.started_at >= v_prev_from and c.started_at < v_to
  ),
  offs as (
    select o.created_at as at, o.status::text as status, o.responded_at from public.offers o
    where o.tenant_id = v_tenant and (v_include or o.is_sample = false) and o.status::text <> 'draft'
      and (v_ids is null or o.created_by = any (v_ids))
      and o.created_at >= v_prev_from and o.created_at < v_to
  ),
  closed as (
    select d.id, d.stage, coalesce(d.deal_value, 0) as deal_value, d.closed_at as at, d.loss_reason, d.customer_id
    from public.deals d
    where d.tenant_id = v_tenant and d.stage in ('won', 'lost') and (v_include or d.is_sample = false)
      and (v_ids is null or d.assigned_to = any (v_ids))
      and d.closed_at >= v_prev_from and d.closed_at < v_to
  ),
  comm as (
    select c.created_at as at, c.gross_amount
    from public.commissions c
    join public.deals d on d.id = c.deal_id and d.tenant_id = c.tenant_id
    where v_earn and c.tenant_id = v_tenant and (v_include or c.is_sample = false)
      and (v_ids is null or d.assigned_to = any (v_ids))
      and c.created_at >= v_prev_from and c.created_at < v_to
  ),
  periods(k, f, t) as (
    values ('current', v_from, v_to), ('previous', v_prev_from, v_from)
  ),
  metrics as (
    select pr.k,
      (select count(*) from cust x where x.created_at >= pr.f and x.created_at < pr.t) as new_customers,
      (select count(*) from dem x where x.created_at >= pr.f and x.created_at < pr.t) as new_demands,
      (select count(*) from props x where x.created_at >= pr.f and x.created_at < pr.t) as new_listings,
      (select count(*) from appts x where x.at >= pr.f and x.at < pr.t) as appointments,
      (select count(*) from calls_ x where x.at >= pr.f and x.at < pr.t) as calls,
      (select count(*) from offs x where x.at >= pr.f and x.at < pr.t) as offers,
      (select count(*) from offs x where x.at >= pr.f and x.at < pr.t and x.status = 'accepted') as offers_accepted,
      (select count(*) from closed x where x.at >= pr.f and x.at < pr.t and x.stage = 'won') as won,
      (select coalesce(sum(x.deal_value), 0) from closed x where x.at >= pr.f and x.at < pr.t and x.stage = 'won') as won_value,
      (select count(*) from closed x where x.at >= pr.f and x.at < pr.t and x.stage = 'lost') as lost,
      (select coalesce(sum(x.deal_value), 0) from closed x where x.at >= pr.f and x.at < pr.t and x.stage = 'lost') as lost_value,
      case when v_earn then (select coalesce(sum(x.gross_amount), 0) from comm x where x.at >= pr.f and x.at < pr.t) end as commission
    from periods pr
  ),
  sources as (
    select x.source, count(*) as customer_count
    from cust x where x.created_at >= v_from
    group by x.source
  ),
  won_sources as (
    select coalesce(nullif(btrim(c.source), ''), 'Belirtilmedi') as source,
           count(*) as won_count, coalesce(sum(x.deal_value), 0) as won_value
    from closed x
    join public.customers c on c.id = x.customer_id and c.tenant_id = v_tenant
    where x.at >= v_from and x.stage = 'won'
    group by 1
  ),
  roi as (
    select coalesce(s.source, w.source) as source,
           coalesce(s.customer_count, 0) as customers,
           coalesce(w.won_count, 0) as won_count,
           coalesce(w.won_value, 0) as won_value
    from sources s full join won_sources w using (source)
  ),
  losses as (
    select coalesce(nullif(btrim(x.loss_reason), ''), 'Belirtilmedi') as reason,
           count(*) as deal_count, coalesce(sum(x.deal_value), 0) as deal_value
    from closed x where x.at >= v_from and x.stage = 'lost'
    group by 1
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'prev_from', v_prev_from_date,
    'prev_to', p_from - 1,
    'scoped', v_ids is not null,
    'sample_included', v_include,
    'earnings_visible', v_earn,
    'current', (select to_jsonb(m) - 'k' from metrics m where m.k = 'current'),
    'previous', (select to_jsonb(m) - 'k' from metrics m where m.k = 'previous'),
    'customer_sources', coalesce((select jsonb_agg(to_jsonb(s) order by s.customer_count desc, s.source) from sources s), '[]'::jsonb),
    'roi', coalesce((select jsonb_agg(to_jsonb(r) order by r.won_value desc, r.won_count desc, r.customers desc, r.source) from roi r), '[]'::jsonb),
    'loss_reasons', coalesce((select jsonb_agg(to_jsonb(l) order by l.deal_count desc, l.deal_value desc, l.reason) from losses l), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.report_sales_funnel(
  p_from date,
  p_to date,
  p_branch uuid default null,
  p_team uuid default null,
  p_profile uuid default null,
  p_sample_threshold integer default 5
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_active_tenant_id();
  v_from timestamptz;
  v_to timestamptz;
  v_ids uuid[];
  v_include boolean;
  v_earn boolean;
  v_exp boolean;
  v_result jsonb;
begin
  if v_tenant is null or not public.has_effective_permission('reports', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 1100 then
    raise exception 'invalid period' using errcode = '22023';
  end if;
  v_from := p_from::timestamp at time zone 'Europe/Istanbul';
  v_to := (p_to + 1)::timestamp at time zone 'Europe/Istanbul';
  v_ids := public.report_scope_member_ids(p_branch, p_team, p_profile);
  v_include := public.report_sample_included(p_sample_threshold);
  v_earn := public.has_effective_permission('earnings_all', 'view');
  v_exp := public.has_effective_permission('expenses', 'view');

  with
  cohort as (
    select c.id, c.created_at, c.assigned_to,
           coalesce(nullif(btrim(c.source), ''), 'Belirtilmedi') as source
    from public.customers c
    where c.tenant_id = v_tenant and c.deleted_at is null and (v_include or c.is_sample = false)
      and (v_ids is null or c.assigned_to = any (v_ids))
      and c.created_at >= v_from and c.created_at < v_to
  ),
  steps as (
    select k.*,
      (select min(a.scheduled_at) from public.appointments a
        where a.tenant_id = v_tenant and a.customer_id = k.id and a.status <> 'cancelled') as first_appt,
      (select min(o.created_at) from public.offers o
        where o.tenant_id = v_tenant and o.customer_id = k.id and o.status::text <> 'draft') as first_offer,
      (select min(d.closed_at) from public.deals d
        where d.tenant_id = v_tenant and d.customer_id = k.id and d.stage = 'won') as first_won,
      (select coalesce(sum(d.deal_value), 0) from public.deals d
        where d.tenant_id = v_tenant and d.customer_id = k.id and d.stage = 'won') as won_value,
      case when v_earn then (
        select coalesce(sum(cm.gross_amount), 0) from public.commissions cm
        join public.deals d on d.id = cm.deal_id and d.tenant_id = cm.tenant_id
        where cm.tenant_id = v_tenant and d.customer_id = k.id and d.stage = 'won'
      ) end as commission
    from cohort k
  ),
  exp as (
    select case when e.portal_key is not null and btrim(e.portal_key) <> '' then 'portal_' || btrim(e.portal_key)
                else coalesce(nullif(btrim(e.category), ''), 'diger') end as cost_key,
           e.category, e.portal_key, e.amount
    from public.expenses e
    where v_exp and e.tenant_id = v_tenant and (v_include or e.is_sample = false)
      and e.expense_date >= p_from and e.expense_date <= p_to
  ),
  by_source as (
    select s.source,
           count(*) as customers,
           count(*) filter (where s.first_appt is not null) as appointments,
           count(*) filter (where s.first_offer is not null) as offers,
           count(*) filter (where s.first_won is not null) as won,
           coalesce(sum(s.won_value), 0) as won_value,
           case when v_earn then coalesce(sum(s.commission), 0) end as commission,
           round((percentile_cont(0.5) within group (order by extract(epoch from (s.first_won - s.created_at)) / 86400.0))::numeric, 1) as median_days_to_won
    from steps s
    group by s.source
  ),
  source_costs as (
    select x.cost_key as source, sum(x.amount) as cost from exp x group by x.cost_key
  ),
  sources_all as (
    select coalesce(b.source, sc.source) as source,
           coalesce(b.customers, 0) as customers, coalesce(b.appointments, 0) as appointments,
           coalesce(b.offers, 0) as offers, coalesce(b.won, 0) as won, coalesce(b.won_value, 0) as won_value,
           case when v_earn then coalesce(b.commission, 0) end as commission,
           b.median_days_to_won,
           case when v_exp then coalesce(sc.cost, 0) end as cost
    from by_source b
    -- Portal giderleri talep gelmese de satir olur (odenen ama sonuc vermeyen kaynak gorunsun); diger kategoriler yalniz
    -- ayni adli kaynak varsa eslenir.
    full join (select * from source_costs sc0
               where sc0.source in (select source from by_source) or sc0.source like 'portal\_%') sc using (source)
  ),
  by_advisor as (
    select s.assigned_to as profile_id, max(p.full_name) as full_name,
           count(*) as customers,
           count(*) filter (where s.first_appt is not null) as appointments,
           count(*) filter (where s.first_offer is not null) as offers,
           count(*) filter (where s.first_won is not null) as won,
           coalesce(sum(s.won_value), 0) as won_value,
           case when v_earn then coalesce(sum(s.commission), 0) end as commission
    from steps s
    left join public.profiles p on p.id = s.assigned_to and p.tenant_id = v_tenant
    group by s.assigned_to
  ),
  totals as (
    select count(*) as customers,
           count(*) filter (where s.first_appt is not null) as appointments,
           count(*) filter (where s.first_offer is not null) as offers,
           count(*) filter (where s.first_won is not null) as won,
           coalesce(sum(s.won_value), 0) as won_value,
           case when v_earn then coalesce(sum(s.commission), 0) end as commission,
           round((percentile_cont(0.5) within group (order by extract(epoch from (s.first_appt - s.created_at)) / 86400.0))::numeric, 1) as median_days_to_appt,
           round((percentile_cont(0.5) within group (order by extract(epoch from (s.first_offer - s.created_at)) / 86400.0))::numeric, 1) as median_days_to_offer,
           round((percentile_cont(0.5) within group (order by extract(epoch from (s.first_won - s.created_at)) / 86400.0))::numeric, 1) as median_days_to_won
    from steps s
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'scoped', v_ids is not null,
    'sample_included', v_include,
    'earnings_visible', v_earn,
    'expenses_visible', v_exp,
    'totals', (select to_jsonb(t) from totals t),
    'sources', coalesce((select jsonb_agg(to_jsonb(s) order by s.customers desc, s.won_value desc, s.source) from sources_all s), '[]'::jsonb),
    'advisors', coalesce((select jsonb_agg(to_jsonb(a) order by a.won_value desc, a.won desc, a.customers desc) from by_advisor a), '[]'::jsonb),
    -- Kaynaga baglanmamis pazarlama gideri: 'reklam' kategorisinde, portal anahtari olmayan ve hicbir kaynak adiyla eslesmeyen.
    'cost_unattributed', case when v_exp then (select coalesce(sum(x.amount), 0) from exp x
                                                where x.category = 'reklam'
                                                  and (x.portal_key is null or btrim(x.portal_key) = '')
                                                  and x.cost_key not in (select source from by_source)) end
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.report_period_overview(date, date, uuid, uuid, uuid, integer) from public, anon;
grant execute on function public.report_period_overview(date, date, uuid, uuid, uuid, integer) to authenticated;
revoke all on function public.report_sales_funnel(date, date, uuid, uuid, uuid, integer) from public, anon;
grant execute on function public.report_sales_funnel(date, date, uuid, uuid, uuid, integer) to authenticated;

comment on function public.report_period_overview(date, date, uuid, uuid, uuid, integer) is
  'OA1: donem + onceki esdeger donem akis metrikleri, kaynak/ROI/kayip (sube/takim/danisman kapsamli). SECURITY INVOKER.';
comment on function public.report_sales_funnel(date, date, uuid, uuid, uuid, integer) is
  'OA2: musteri kohortu hunisi (randevu/teklif/kazanilan/komisyon) kaynak + danisman kirilimli, kaynak maliyeti. SECURITY INVOKER.';
