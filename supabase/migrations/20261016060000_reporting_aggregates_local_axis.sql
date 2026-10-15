-- MIGRATION 20261016060000_reporting_aggregates_local_axis.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI uygular.
-- Geri alma: supabase/rollbacks/20261016060000_reporting_aggregates_local_axis.rollback.sql (canli govdeler birebir + yeni fonksiyonun silinmesi).
-- BAGIMLILIK: 20261011001300_earnings_statement_privacy.sql (iki fonksiyonun son govdesi + ACL), 20260816000200 (commission_splits).
--
-- BULGU SK6/B077 (ay ekseni): eksen generate_series(timestamptz, timestamptz, '1 month') ile, oturum TZ=UTC iken uretiliyordu.
--   Ilk deger Istanbul ay basinin UTC ani (or. 30 Eyl 21:00Z); UTC takviminde '+1 ay' eklendikce gun kayiyordu (30 Eki, 30 Kas,
--   28 Sub, 28 Mar ...). Sonuc: kova sinirlari ayin 28/29'una oturuyor, Raporlar Ekim gelirini 'Eyl' etiketiyle gosteriyor,
--   komisyon 6 aylik ekseninde Mayis/Temmuz ikiser kez geliyor (Haziran/Eylul hic olusmuyor). Ayni kayma 'onceki ay' sinirinda da vardi
--   (ay basi timestamptz - interval '1 month' UTC'de hesaplaniyordu).
-- BULGU SK6/B158 (rapor onbellegi): tenant_reporting_aggregates kullaniciya gore degisen sonuc donduruyordu (earnings_all yoksa yalniz
--   KENDI komisyonlari), ama kod bunu kiraci anahtarli onbellekte tutuyordu: onbellegi kim doldurursa ofisteki herkes 60 sn onun sonucunu
--   goruyordu (danisman/salt okunur ofis cirosunu, sahip 0 TL).
-- BULGU SK6/B165-2: monthly.expense (gider toplami) expenses izni sorulmadan reports:view sahibi herkese donuyordu.
--
-- COZUM:
--  1) tenant_reporting_aggregates YALNIZ OFIS GENELI ve kullanicidan BAGIMSIZ veriyi dondurur (sayimlar, kaynak/kayip/ROI, kayip komisyon
--     tahmini). Komisyon ve gider serisi bu fonksiyondan CIKAR (anahtarlar yok). Boylece kiraci anahtarli onbellekte guvenle tutulur.
--  2) YENI tenant_reporting_viewer_aggregates: kullaniciya/izne gore degisen hafif kisim (bu ayin komisyonu + 12 ay gelir/gider serisi).
--     Komisyon: earnings_all:view yoksa yalniz KENDI kayitlari (atanan danisman veya commission_splits payi; 20261011001300 ile ayni anlam).
--     Gider: yalniz expenses:view varsa doludur; yoksa her ayin expense'i NULL ve expense_visible=false.
--     Bu fonksiyon onbelleksiz cagrilir (src/lib/reporting/cache.ts).
--  3) Iki fonksiyon (ve tenant_commission_aggregates) ekseni Istanbul YEREL ayi (timestamp without time zone) uzerinden kurar:
--     lm = date_trunc('month', p_as_of at time zone 'Europe/Istanbul'); kova [lm at tz, (lm + 1 ay) at tz). Gider karsilastirmasi lm::date.
--     Her ay satiri 'ym' (YYYY-MM) tasir; kod ayi bu alandan eslestirir (konumla degil).
-- IMZA/ACL: tenant_reporting_aggregates ve tenant_commission_aggregates imzasi ayni (CREATE OR REPLACE ACL'i korur; yine de yeniden yazilir).
-- KOD SIRASI: KOD YAYINIYLA AYNI PENCERE (once migration, sonra kod). Arada eski kod Raporlar'da komisyon/gider serisini bos (0/NaN)
--   gosterebilir; sizinti olmaz. Komisyon sayfasi ve ana ekran eski kodla da calisir (month_start korunur, ym eklenir).
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.commission_splits') is null
     or pg_catalog.to_regprocedure('public.has_effective_permission(text,text)') is null
     or pg_catalog.to_regprocedure('public.current_active_tenant_id()') is null then
    raise exception '20261016060000: commission_splits / has_effective_permission / current_active_tenant_id yok.';
  end if;
end $$;

-- 1) Ofis geneli (kullanicidan bagimsiz) rapor toplulastirmasi.
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
  -- Istanbul yerel ay basi (timestamp without time zone) ve ondan turetilen kesin UTC anlari.
  v_lm timestamp := date_trunc('month', p_as_of at time zone 'Europe/Istanbul');
  v_month_start timestamptz := v_lm at time zone 'Europe/Istanbul';
  v_month_end timestamptz := (v_lm + interval '1 month') at time zone 'Europe/Istanbul';
  v_prev_start timestamptz := (v_lm - interval '1 month') at time zone 'Europe/Istanbul';
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

  with summary as (
    select
      (select count(*) from public.customers c where c.tenant_id = v_tenant and c.deleted_at is null and (v_include or c.is_sample = false)) as customers,
      (select count(*) from public.customer_demands d where d.tenant_id = v_tenant and d.status in ('new','active','matched') and (v_include or d.is_sample = false)) as demands,
      (select count(*) from public.properties p where p.tenant_id = v_tenant and p.deleted_at is null and (v_include or p.is_sample = false)) as properties,
      (select count(*) from public.portal_listings p where p.tenant_id = v_tenant and p.status = 'live') as live_portals,
      (select count(*) from public.portal_listings p where p.tenant_id = v_tenant and p.status = 'live' and (p.last_confirmed_at is null or p.last_confirmed_at < p_as_of - interval '7 days')) as overdue_confirmations,
      (select coalesce(sum(l.estimated_lost_commission), 0) from public.listing_closures l where l.tenant_id = v_tenant and l.created_at >= v_month_start and l.created_at < v_month_end) as month_lost,
      (select coalesce(sum(l.estimated_lost_commission), 0) from public.listing_closures l where l.tenant_id = v_tenant and l.created_at >= v_prev_start and l.created_at < v_month_start) as prev_month_lost,
      (select count(*) from public.customer_demands d where d.tenant_id = v_tenant and d.created_at >= v_month_start and d.created_at < v_month_end and (v_include or d.is_sample = false)) as month_new_demands,
      (select count(*) from public.customer_demands d where d.tenant_id = v_tenant and d.created_at >= v_prev_start and d.created_at < v_month_start and (v_include or d.is_sample = false)) as prev_month_new_demands,
      (select count(*) from public.listing_closures l where l.tenant_id = v_tenant and l.created_at >= p_as_of - interval '30 days') as closures_30d,
      (select count(*) from public.appointments a where a.tenant_id = v_tenant and a.scheduled_at >= p_as_of - interval '7 days' and a.scheduled_at <= p_as_of and (v_include or a.is_sample = false)) as appointments_7d,
      (select count(*) from public.calls c where c.tenant_id = v_tenant and c.started_at >= p_as_of - interval '7 days' and c.started_at <= p_as_of and (v_include or c.is_sample = false)) as calls_7d
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
  )
  select jsonb_build_object(
    'summary', to_jsonb(s),
    'customer_sources', coalesce((select jsonb_agg(to_jsonb(x) order by x.customer_count desc, x.source) from customer_sources x), '[]'::jsonb),
    'loss_reasons', coalesce((select jsonb_agg(to_jsonb(x) order by x.deal_count desc, x.deal_value desc, x.reason) from lost_reasons x), '[]'::jsonb),
    'roi', coalesce((select jsonb_agg(to_jsonb(x) order by x.won_value desc, x.won_count desc, x.customers desc, x.source) from roi x), '[]'::jsonb),
    'month_ym', to_char(v_lm, 'YYYY-MM'),
    'sample_included', v_include
  ) into v_result
  from summary s;

  return v_result;
end;
$$;

-- 2) Kullaniciya/izne gore degisen hafif kisim (onbelleksiz cagrilir).
create or replace function public.tenant_reporting_viewer_aggregates(
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
  v_all boolean;
  v_expense boolean;
  v_uid uuid := auth.uid();
  v_lm timestamp := date_trunc('month', p_as_of at time zone 'Europe/Istanbul');
  v_first timestamp := date_trunc('month', p_as_of at time zone 'Europe/Istanbul') - interval '11 months';
  v_result jsonb;
begin
  if v_tenant is null or not public.has_effective_permission('reports', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Kazanc gizliligi: earnings_all:view yoksa komisyon toplamlari yalniz KENDI kayitlarini icerir (ofis toplami sizmaz).
  v_all := public.has_effective_permission('earnings_all', 'view');
  -- Gider serisi yalniz expenses:view ile (SK6/B165): izin yoksa NULL.
  v_expense := public.has_effective_permission('expenses', 'view');

  select count(*) into v_real_customers from public.customers c
   where c.tenant_id = v_tenant and c.is_sample = false and c.deleted_at is null;
  select count(*) into v_real_properties from public.properties p
   where p.tenant_id = v_tenant and p.is_sample = false and p.deleted_at is null;
  v_include := (v_real_customers < v_threshold and v_real_properties < v_threshold);

  with axis as (
    select g.lm,
           to_char(g.lm, 'YYYY-MM') as ym,
           g.lm at time zone 'Europe/Istanbul' as month_start,
           (g.lm + interval '1 month') at time zone 'Europe/Istanbul' as month_end
      from generate_series(v_first, v_lm, interval '1 month') as g(lm)
  ),
  comm as (
    select c.created_at, c.gross_amount
      from public.commissions c
     where c.tenant_id = v_tenant
       and c.created_at >= v_first at time zone 'Europe/Istanbul'
       and c.created_at < (v_lm + interval '1 month') at time zone 'Europe/Istanbul'
       and (v_include or c.is_sample = false)
       and (v_all
            or exists (select 1 from public.deals dd where dd.id = c.deal_id and dd.tenant_id = c.tenant_id and dd.assigned_to = v_uid)
            or exists (select 1 from public.commission_splits cs where cs.commission_id = c.id and cs.tenant_id = c.tenant_id and cs.profile_id = v_uid))
  ),
  exp as (
    select e.expense_date, e.amount
      from public.expenses e
     where v_expense
       and e.tenant_id = v_tenant
       and e.expense_date >= v_first::date
       and e.expense_date < (v_lm + interval '1 month')::date
       and (v_include or e.is_sample = false)
  ),
  monthly as (
    select a.ym,
           a.month_start,
           coalesce((select sum(c.gross_amount) from comm c where c.created_at >= a.month_start and c.created_at < a.month_end), 0) as income,
           case when v_expense then
             coalesce((select sum(e.amount) from exp e where e.expense_date >= a.lm::date and e.expense_date < (a.lm + interval '1 month')::date), 0)
           end as expense
      from axis a
  )
  select jsonb_build_object(
    'month_ym', to_char(v_lm, 'YYYY-MM'),
    'month_commission', coalesce((select m.income from monthly m where m.ym = to_char(v_lm, 'YYYY-MM')), 0),
    'monthly', coalesce((select jsonb_agg(to_jsonb(m) order by m.ym) from monthly m), '[]'::jsonb),
    'earnings_scope', case when v_all then 'office' else 'own' end,
    'expense_visible', v_expense,
    'sample_included', v_include
  ) into v_result;

  return v_result;
end;
$$;

-- 3) Komisyon toplulastirmasi: ayni yerel eksen + ym (kazanc gizliligi 20261011001300 ile ayni).
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
  v_all boolean;
  v_uid uuid := auth.uid();
  v_lm timestamp := date_trunc('month', p_as_of at time zone 'Europe/Istanbul');
  v_month_start timestamptz := v_lm at time zone 'Europe/Istanbul';
  v_month_end timestamptz := (v_lm + interval '1 month') at time zone 'Europe/Istanbul';
  v_result jsonb;
begin
  if v_tenant is null or not public.has_effective_permission('commissions', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Kazanc gizliligi: earnings_all:view yoksa yalniz KENDI kayitlari (atanan danisman veya payi olan) toplanir; dagilim bos doner.
  v_all := public.has_effective_permission('earnings_all', 'view');

  select count(*) into v_real_customers from public.customers c
   where c.tenant_id = v_tenant and c.is_sample = false and c.deleted_at is null;
  select count(*) into v_real_properties from public.properties p
   where p.tenant_id = v_tenant and p.is_sample = false and p.deleted_at is null;
  v_include := (v_real_customers < v_threshold and v_real_properties < v_threshold);

  with scoped as (
    select c.* from public.commissions c
    where c.tenant_id = v_tenant and (v_include or c.is_sample = false)
      and (v_all
           or exists (select 1 from public.deals d where d.id = c.deal_id and d.tenant_id = c.tenant_id and d.assigned_to = v_uid)
           or exists (select 1 from public.commission_splits cs where cs.commission_id = c.id and cs.tenant_id = c.tenant_id and cs.profile_id = v_uid))
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
    from scoped c
    where c.created_at >= v_month_start
      and c.created_at < v_month_end
  ),
  month_axis as (
    select g.lm,
           to_char(g.lm, 'YYYY-MM') as ym,
           g.lm at time zone 'Europe/Istanbul' as month_start,
           (g.lm + interval '1 month') at time zone 'Europe/Istanbul' as month_end
      from generate_series(v_lm - interval '5 months', v_lm, interval '1 month') as g(lm)
  ),
  monthly as (
    select
      m.ym,
      m.month_start,
      coalesce(sum(c.gross_amount), 0) as accrued,
      coalesce(sum(c.gross_amount) filter (where c.status in ('paid', 'collected')), 0) as paid
    from month_axis m
    left join scoped c
      on c.created_at >= m.month_start
     and c.created_at < m.month_end
    group by m.ym, m.month_start
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
  -- Taraf kimligi profile_id'dir (Konsey #0+#8): ayni etiketli iki kisi birlesmez; profil adi guncel adi gosterir.
  advisors as (
    select coalesce(max(p.full_name), max(r.label)) as label,
           r.profile_id,
           bool_or(r.unresolved) as unresolved,
           coalesce(sum(r.pay), 0) as pay,
           count(distinct r.id) as record_count
    from split_rows r
    left join public.profiles p on p.id = r.profile_id and p.tenant_id = v_tenant
    where r.pay > 0 and v_all
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
    'month_ym', to_char(v_lm, 'YYYY-MM'),
    'monthly', coalesce((select jsonb_agg(to_jsonb(m) order by m.ym) from monthly m), '[]'::jsonb),
    'advisors', coalesce((select jsonb_agg(to_jsonb(a) order by a.pay desc, a.label) from advisors a), '[]'::jsonb),
    'sample_included', v_include
  ) into v_result
  from totals t cross join current_month cm;

  return v_result;
end;
$$;

revoke all on function public.tenant_reporting_aggregates(timestamptz, integer) from public, anon;
grant execute on function public.tenant_reporting_aggregates(timestamptz, integer) to authenticated;
revoke all on function public.tenant_reporting_viewer_aggregates(timestamptz, integer) from public, anon;
grant execute on function public.tenant_reporting_viewer_aggregates(timestamptz, integer) to authenticated;
revoke all on function public.tenant_commission_aggregates(timestamptz, integer) from public, anon;
grant execute on function public.tenant_commission_aggregates(timestamptz, integer) to authenticated;
