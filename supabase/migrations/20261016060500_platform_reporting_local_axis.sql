-- MIGRATION 20261016060500_platform_reporting_local_axis.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI uygular.
-- Geri alma: supabase/rollbacks/20261016060500_platform_reporting_local_axis.rollback.sql (20260802000340 govdesi birebir).
-- BAGIMLILIK: 20261016060400_tenant_is_internal.sql (tenants.is_internal) ve 20261013001000 (platform_mrr_daily) ONCE uygulanir.
--
-- BULGU SK6/B110 (platform MRR'i uc ekranda uc deger: 17.470 / 11.980): (1) ic/test/demo ofisler gelir sayiliyordu; (2) mrr_trend
--   BUGUNKU status='active' kumesini created_at < ay sonu ile gecmise yayiyordu (gecmis ayin MRR'i degil, bugunun kohortu);
--   (3) p_from/p_to ve ay/hafta ekseni oturum saat dilimiyle (UTC) kesiliyordu: TR ayinin ilk 3 saati onceki aya dusuyordu;
--   (4) plan ekseni 4 sabit planla sinirliydi: gizli/yeni paketteki aktif abonelik MRR toplamindan sessizce dusuyordu.
-- COZUM (cikti anahtarlari ve tipleri AYNI; kod sozlesmesi lib/reporting/platform.ts korunur):
--   - tenant_scope / subscription_scope / haftalik / benimseme / ust ofisler / uye sayisi ic ofisleri (is_internal) disarida birakir.
--     Destek talebi sayaclari (operasyon is yuku) suzulmez.
--   - p_from/p_to, ay ve hafta sinirlari Europe/Istanbul yerel gun/ay/haftasindan kurulur; ay satirlari 'ym' (YYYY-AA) tasir.
--   - plan_stats ekseni = 4 temel plan + kapsamdaki ofis/aboneliklerde gecen her plan (MRR = aktif aboneliklerin amount_try toplami).
--   - mrr_trend artik tahmin/geriye yayma DEGIL: her TR ayinin SON platform_mrr_daily anlik goruntu gunu (ic ofisler haric).
--     Anlik goruntusu olmayan ay satir uretmez ("veri yok"; sifir cizilmez). *_count = o gun MRR'i > 0 olan ofis,
--     *_subscription_count ayni sayi (katalog yedegi kalmadi).
--   - summary.missing_subscription_count: aktif ama aktif aboneligi olmayan ofis (uyari sayaci; MRR'a 0 ekler);
--     summary.internal_count: disarida birakilan ic ofis sayisi.
-- GUVENLIK DEGISMEZ: SECURITY DEFINER, yalniz service_role (govde basi kapisi + REVOKE/GRANT yeniden yazilir), imza ayni.
-- KOD SIRASI: bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir (kod yeni summary anahtarlari yokken plan_stats'tan hesaplar).
-- Idempotent: create or replace + revoke/grant.
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
  v_tz constant text := 'Europe/Istanbul';
  v_from timestamptz := case when p_from is null then null else (p_from::timestamp at time zone 'Europe/Istanbul') end;
  v_to timestamptz := case when p_to is null then null else ((p_to + 1)::timestamp at time zone 'Europe/Istanbul') end;
  v_today date := (coalesce(p_as_of, now()) at time zone 'Europe/Istanbul')::date;
  v_month0 date := date_trunc('month', (coalesce(p_as_of, now()) at time zone 'Europe/Istanbul'))::date;
  v_week0 date := date_trunc('week', (coalesce(p_as_of, now()) at time zone 'Europe/Istanbul'))::date;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with internal as (
    select t.id from public.tenants t where t.is_internal
  ),
  tenant_scope as (
    select t.* from public.tenants t
    where not t.is_internal
      and (v_from is null or t.created_at >= v_from)
      and (v_to is null or t.created_at < v_to)
  ),
  subscription_scope as (
    select s.* from public.subscriptions s
    where s.tenant_id not in (select i.id from internal i)
      and (v_from is null or s.created_at >= v_from)
      and (v_to is null or s.created_at < v_to)
  ),
  ticket_scope as (
    select t.* from public.support_tickets t
    where (v_from is null or t.created_at >= v_from)
      and (v_to is null or t.created_at < v_to)
  ),
  summary as (
    select
      (select count(*) from tenant_scope) as tenant_count,
      (select count(*) from tenant_scope where status = 'active') as active_count,
      (select count(*) from tenant_scope where status = 'trial') as trial_count,
      (select count(*) from tenant_scope where status in ('past_due','suspended')) as risk_count,
      (select count(*) from tenant_scope where status = 'cancelled') as cancelled_count,
      (select count(*) from public.tenants t
        where not t.is_internal and t.status = 'trial' and t.trial_ends_at > p_as_of and t.trial_ends_at < p_as_of + interval '7 days') as trials_ending_7d,
      (select count(*) from public.profiles p where p.tenant_id is null or p.tenant_id not in (select i.id from internal i)) as member_count,
      (select count(*) from ticket_scope) as ticket_count,
      (select count(*) from ticket_scope where status in ('open','in_progress','waiting')) as open_ticket_count,
      (select count(*) from ticket_scope where priority = 'urgent' and status not in ('resolved','closed')) as urgent_ticket_count,
      (select count(*) from ticket_scope where status in ('resolved','closed')) as resolved_ticket_count,
      (select count(*) from public.demo_requests where status = 'new') as new_demo_count,
      -- subscriptions.amount_try kayit/faturalama islemlerinde kanonik aylik (MRR) tutara normalize edilir.
      (select coalesce(sum(amount_try), 0) from subscription_scope where status = 'active') as subscription_mrr,
      (select count(*) from tenant_scope t
        where t.status = 'active'
          and not exists (select 1 from public.subscriptions s where s.tenant_id = t.id and s.status = 'active')) as missing_subscription_count,
      (select count(*) from internal) as internal_count
  ),
  plan_axis(plan) as (
    select x.plan from (values ('advisor'::text), ('office'::text), ('professional'::text), ('enterprise'::text)) as x(plan)
    union
    select t.plan from tenant_scope t where t.plan is not null
    union
    select s.plan from subscription_scope s where s.plan is not null and s.status = 'active'
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
    select g::date as month_start
    from generate_series(v_month0 - interval '11 months', v_month0::timestamp, interval '1 month') as g
  ),
  month_end as (
    select m.month_start,
      (select max(d.day) from public.platform_mrr_daily d
        where d.day >= m.month_start
          and d.day < (m.month_start + interval '1 month')::date
          and d.day <= v_today) as snap_day
    from month_axis m
  ),
  mrr_trend as (
    select
      (me.month_start::timestamp at time zone v_tz) as month_start,
      to_char(me.month_start, 'YYYY-MM') as ym,
      me.snap_day,
      coalesce(sum(d.mrr_try) filter (where not t.is_internal), 0) as subscription_mrr,
      count(*) filter (where not t.is_internal and d.mrr_try > 0 and d.plan_id = 'advisor') as advisor_count,
      count(*) filter (where not t.is_internal and d.mrr_try > 0 and d.plan_id = 'advisor') as advisor_subscription_count,
      count(*) filter (where not t.is_internal and d.mrr_try > 0 and d.plan_id = 'office') as office_count,
      count(*) filter (where not t.is_internal and d.mrr_try > 0 and d.plan_id = 'office') as office_subscription_count,
      count(*) filter (where not t.is_internal and d.mrr_try > 0 and d.plan_id = 'professional') as professional_count,
      count(*) filter (where not t.is_internal and d.mrr_try > 0 and d.plan_id = 'professional') as professional_subscription_count,
      count(*) filter (where not t.is_internal and d.mrr_try > 0 and d.plan_id = 'enterprise') as enterprise_count,
      count(*) filter (where not t.is_internal and d.mrr_try > 0 and d.plan_id = 'enterprise') as enterprise_subscription_count
    from month_end me
    join public.platform_mrr_daily d on d.day = me.snap_day
    join public.tenants t on t.id = d.tenant_id
    where me.snap_day is not null
    group by me.month_start, me.snap_day
  ),
  week_axis as (
    select (g::date::timestamp at time zone v_tz) as week_start
    from generate_series(v_week0 - interval '7 weeks', v_week0::timestamp, interval '1 week') as g
  ),
  weekly as (
    select w.week_start,
      (select count(*) from public.tenants t
        where not t.is_internal and t.created_at >= w.week_start and t.created_at < w.week_start + interval '1 week') as tenants,
      (select count(*) from public.subscriptions s
        where s.status = 'active' and s.tenant_id not in (select i.id from internal i)
          and s.created_at >= w.week_start and s.created_at < w.week_start + interval '1 week') as active_subscriptions,
      (select count(*) from public.tenants t
        where not t.is_internal and t.status = 'trial' and t.created_at >= w.week_start and t.created_at < w.week_start + interval '1 week') as trials,
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
    where a.tenant_id is not null
      and a.tenant_id not in (select i.id from internal i)
      and a.created_at >= p_as_of - interval '30 days'
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
    'all_tenant_count', (select count(*) from public.tenants t where not t.is_internal)
  ) into v_result
  from summary s;

  return v_result;
end;
$$;

revoke all on function public.platform_reporting_aggregates(date, date, timestamptz) from public, anon, authenticated;
grant execute on function public.platform_reporting_aggregates(date, date, timestamptz) to service_role;
