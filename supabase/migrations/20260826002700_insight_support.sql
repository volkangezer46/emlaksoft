-- MIGRATION 20260826002700_insight_support.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826002700_insight_support.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826002700_insight_support.rollback.sql
-- BAGIMLILIK: 20260826002500_insights (insights tablosu); 20260826002600 varsa temizlik platform_insights'i de kapsar.
--   Okunan tablolar: customers, customer_demands, communications, appointments, calls, deals, offers, tasks, properties,
--   portal_listings (hepsi temel migrationlarda).
--
-- AMAC: Insight Engine'in OLGU toplama katmani. `limit(200)` gibi sessiz eksik sayan istemci taramalari yerine
--   SET-TABANLI, tenant filtreli, ornek veriyi (is_sample) disarida birakan RPC'ler; "en riskli N" SQL'de siralanir.
--   Hepsi YALNIZ service_role'e acik (engine, tenant kimligini kendisi verir): anon/authenticated EXECUTE yok.
--   + insight_rule_quality gorunumu (kural kalitesi/yanlis alarm orani) + temizlik fonksiyonu.
--
-- ETKI: yalniz yeni fonksiyon/gorunum (ek). Tablo/veri degismez.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.insights') is null then
    raise exception 'public.insights yok; once 20260826002500_insights uygulanmali.';
  end if;
end $$;

-- 1) Sessiz ama degerli musteriler: acik talebi olan, atanmis, son temasi N gunden eski.
create or replace function public.insight_quiet_valuable_customers(
  p_tenant_id uuid,
  p_min_quiet_days int default 14,
  p_limit int default 200
)
returns table(
  customer_id uuid,
  assigned_to uuid,
  full_name text,
  active_demands int,
  quiet_days int,
  last_activity timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with d as (
    select cd.customer_id, count(*)::int as cnt
    from public.customer_demands cd
    where cd.tenant_id = p_tenant_id
      and cd.is_sample = false
      and cd.status in ('new', 'active', 'matched')
    group by cd.customer_id
  ),
  base as (
    select c.id, c.assigned_to, c.full_name, d.cnt,
      greatest(
        c.created_at,
        (select max(cm.created_at) from public.communications cm
          where cm.tenant_id = p_tenant_id and cm.customer_id = c.id),
        (select max(ap.scheduled_at) from public.appointments ap
          where ap.tenant_id = p_tenant_id and ap.customer_id = c.id and ap.scheduled_at <= pg_catalog.now()),
        (select max(cl.started_at) from public.calls cl
          where cl.tenant_id = p_tenant_id and cl.customer_id = c.id)
      ) as last_at
    from public.customers c
    join d on d.customer_id = c.id
    where c.tenant_id = p_tenant_id
      and c.deleted_at is null
      and c.is_sample = false
      and c.blacklist = false
      and c.assigned_to is not null
  )
  select b.id, b.assigned_to, b.full_name, b.cnt,
         floor(extract(epoch from (pg_catalog.now() - b.last_at)) / 86400)::int,
         b.last_at
  from base b
  where b.last_at <= pg_catalog.now() - pg_catalog.make_interval(days => greatest(coalesce(p_min_quiet_days, 14), 1))
  order by b.cnt desc, b.last_at asc
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

-- 2) Asamada bekleyen (hareketsiz) acik anlasmalar + deal-score sinyalleri.
create or replace function public.insight_stalled_deals(
  p_tenant_id uuid,
  p_min_idle_days int default 14,
  p_limit int default 200
)
returns table(
  deal_id uuid,
  assigned_to uuid,
  stage text,
  deal_type text,
  deal_created_at timestamptz,
  deal_updated_at timestamptz,
  idle_days int,
  age_days int,
  offer_count int,
  accepted_offer boolean,
  open_task_count int,
  appointment_count int,
  deal_value numeric,
  list_price numeric,
  property_title text,
  property_code text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    d.id, d.assigned_to, d.stage, d.deal_type, d.created_at, d.updated_at,
    floor(extract(epoch from (pg_catalog.now() - coalesce(d.updated_at, d.created_at))) / 86400)::int,
    floor(extract(epoch from (pg_catalog.now() - d.created_at)) / 86400)::int,
    (select count(*) from public.offers o
       where o.tenant_id = p_tenant_id and o.property_id = d.property_id
         and (d.customer_id is null or o.customer_id = d.customer_id)
         and o.status::text <> 'draft')::int,
    exists (select 1 from public.offers o
       where o.tenant_id = p_tenant_id and o.property_id = d.property_id
         and (d.customer_id is null or o.customer_id = d.customer_id)
         and o.status::text = 'accepted'),
    (select count(*) from public.tasks t
       where t.tenant_id = p_tenant_id and t.deal_id = d.id and t.status = 'open')::int,
    (select count(*) from public.appointments ap
       where ap.tenant_id = p_tenant_id and ap.customer_id = d.customer_id
         and ap.property_id = d.property_id and ap.status = 'completed')::int,
    d.deal_value, p.list_price, p.title, p.property_code
  from public.deals d
  left join public.properties p on p.id = d.property_id and p.tenant_id = p_tenant_id
  where d.tenant_id = p_tenant_id
    and d.is_sample = false
    and d.assigned_to is not null
    and d.stage not in ('won', 'lost')
    and coalesce(d.updated_at, d.created_at)
        <= pg_catalog.now() - pg_catalog.make_interval(days => greatest(coalesce(p_min_idle_days, 14), 1))
  order by coalesce(d.updated_at, d.created_at) asc
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

-- 3) Haftalik seriler (anormallik kurali): ofis geneli, TR saatiyle hafta (pazartesi), bos haftalar 0.
--    metric: customers | demands | appointments. Gecersiz metrik bos doner. Son satir (is_current) KISMI haftadir.
create or replace function public.insight_weekly_series(
  p_tenant_id uuid,
  p_metric text,
  p_weeks int default 12
)
returns table(week_start date, value int, is_current boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with p as (
    select date_trunc('week', pg_catalog.now() at time zone 'Europe/Istanbul')::date as cur,
           least(greatest(coalesce(p_weeks, 12), 2), 52) as n
  ),
  weeks as (
    select (p.cur - g * 7) as ws, p.cur
    from p, generate_series(0, (select n from p) - 1) as g
  ),
  ev as (
    select date_trunc('week', c.created_at at time zone 'Europe/Istanbul')::date as ws
    from public.customers c
    where p_metric = 'customers' and c.tenant_id = p_tenant_id and c.deleted_at is null and c.is_sample = false
      and c.created_at >= ((select min(ws) from weeks)::timestamp at time zone 'Europe/Istanbul')
    union all
    select date_trunc('week', cd.created_at at time zone 'Europe/Istanbul')::date
    from public.customer_demands cd
    where p_metric = 'demands' and cd.tenant_id = p_tenant_id and cd.is_sample = false
      and cd.created_at >= ((select min(ws) from weeks)::timestamp at time zone 'Europe/Istanbul')
    union all
    select date_trunc('week', ap.created_at at time zone 'Europe/Istanbul')::date
    from public.appointments ap
    where p_metric = 'appointments' and ap.tenant_id = p_tenant_id and ap.is_sample = false
      and ap.created_at >= ((select min(ws) from weeks)::timestamp at time zone 'Europe/Istanbul')
  )
  select w.ws, (select count(*) from ev where ev.ws = w.ws)::int, (w.ws = w.cur)
  from weeks w
  where p_metric in ('customers', 'demands', 'appointments')
  order by w.ws;
$$;

-- 4) Uzun suredir yayinda ilanlar + emsal (ayni ilce/tur/islem tipindeki DIGER yayin ilanlarinin liste fiyati medyani).
--    Emsal en az 5 ilan ise dolar; degilse peer_median NULL (kural "emsal yoksa uretme").
create or replace function public.insight_stale_listings(
  p_tenant_id uuid,
  p_min_days int default 30,
  p_limit int default 200
)
returns table(
  property_id uuid,
  assigned_to uuid,
  property_code text,
  title text,
  list_price numeric,
  days_listed int,
  peer_count int,
  peer_median numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with live as (
    select p.id, p.assigned_to, p.property_code, p.title, p.list_price,
           p.district_id, p.property_type, p.transaction_type,
           floor(extract(epoch from (pg_catalog.now() - coalesce(p.published_at, p.created_at))) / 86400)::int as days
    from public.properties p
    where p.tenant_id = p_tenant_id
      and p.status = 'live'
      and p.deleted_at is null
      and p.is_sample = false
      and p.list_price > 0
  ),
  stale as (
    select * from live
    where days >= greatest(coalesce(p_min_days, 30), 1) and assigned_to is not null
  ),
  peers as (
    select s.id as sid, count(o.id)::int as n,
           percentile_cont(0.5) within group (order by o.list_price) as med
    from stale s
    join live o
      on o.id <> s.id
     and s.district_id is not null
     and o.district_id = s.district_id
     and o.property_type = s.property_type
     and o.transaction_type = s.transaction_type
    group by s.id
  )
  select s.id, s.assigned_to, s.property_code, s.title, s.list_price, s.days,
         coalesce(pe.n, 0),
         case when coalesce(pe.n, 0) >= 5 then pe.med::numeric else null end
  from stale s
  left join peers pe on pe.sid = s.id
  order by s.days desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

-- 5) Yaklasan/gecmis son tarihler: yetki belgesi bitisi (authorization_end) + 7 gunu asan portal teyidi.
--    days_left: kalan gun (negatif = gecikme gun sayisi).
create or replace function public.insight_deadlines(
  p_tenant_id uuid,
  p_within_days int default 15,
  p_limit int default 200
)
returns table(
  deadline_kind text,
  entity_id uuid,
  assigned_to uuid,
  label text,
  due_date date,
  days_left int
)
language sql
stable
security definer
set search_path = ''
as $$
  with today as (select (pg_catalog.now() at time zone 'Europe/Istanbul')::date as d)
  select * from (
    select 'authority'::text as deadline_kind, p.id as entity_id, p.assigned_to,
           coalesce(p.title, p.property_code) as label,
           p.authorization_end as due_date,
           (p.authorization_end - (select d from today))::int as days_left
    from public.properties p
    where p.tenant_id = p_tenant_id
      and p.status = 'live'
      and p.deleted_at is null
      and p.is_sample = false
      and p.assigned_to is not null
      and p.authorization_end is not null
      and p.authorization_end >= (select d from today)
      and p.authorization_end <= (select d from today) + greatest(coalesce(p_within_days, 15), 1)
    union all
    select 'confirm'::text, p.id, p.assigned_to,
           coalesce(p.title, p.property_code),
           null::date,
           (7 - floor(extract(epoch from (pg_catalog.now() - min(coalesce(pl.last_confirmed_at, pl.published_at, pl.created_at)))) / 86400))::int
    from public.portal_listings pl
    join public.properties p on p.id = pl.property_id and p.tenant_id = p_tenant_id
    where pl.tenant_id = p_tenant_id
      and pl.status = 'live'
      and p.status = 'live'
      and p.deleted_at is null
      and p.is_sample = false
      and p.assigned_to is not null
    group by p.id, p.assigned_to, p.title, p.property_code
    having min(coalesce(pl.last_confirmed_at, pl.published_at, pl.created_at)) <= pg_catalog.now() - interval '7 days'
  ) x
  order by x.days_left asc
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

-- 6) Kural kalitesi (son 90 gun): uretilen, gorulen, uygulanan, "yanlis" yoksayilan ve yanlis alarm orani.
--    Oran = yanlis / (uygulanan + yoksayilan). security_invoker: cagiranin yetkisiyle; yalniz service_role okur.
create or replace view public.insight_rule_quality
with (security_invoker = true) as
select
  i.tenant_id,
  i.rule_id,
  count(*)::int as produced,
  (count(*) filter (where i.state <> 'new'))::int as seen,
  (count(*) filter (where i.state = 'accepted'))::int as accepted,
  (count(*) filter (where i.state = 'dismissed'))::int as dismissed,
  (count(*) filter (where i.state = 'dismissed' and i.state_reason = 'yanlis'))::int as dismissed_wrong,
  case
    when count(*) filter (where i.state in ('accepted', 'dismissed')) = 0 then null
    else round(
      100.0 * (count(*) filter (where i.state = 'dismissed' and i.state_reason = 'yanlis'))
      / (count(*) filter (where i.state in ('accepted', 'dismissed'))), 1)
  end as wrong_rate_pct
from public.insights i
where i.created_at >= pg_catalog.now() - interval '90 days'
group by i.tenant_id, i.rule_id;

-- 7) Temizlik/arsiv: suresi gecmis acik satirlar (7 gun tolerans) ve kapanmis (yoksayilan/uygulanan) satirlar (90 gun).
--    Dondurur: silinen toplam satir. platform_insights tablosu varsa o da temizlenir.
create or replace function public.insight_housekeeping(
  p_closed_retention_days int default 90,
  p_expired_grace_days int default 7
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a int := 0;
  v_b int := 0;
  v_c int := 0;
  v_total int := 0;
begin
  delete from public.insights i
   where i.state in ('new', 'seen', 'snoozed')
     and i.valid_until < pg_catalog.now() - pg_catalog.make_interval(days => greatest(coalesce(p_expired_grace_days, 7), 0));
  get diagnostics v_a = row_count;

  delete from public.insights i
   where i.state in ('dismissed', 'accepted')
     and i.updated_at < pg_catalog.now() - pg_catalog.make_interval(days => greatest(coalesce(p_closed_retention_days, 90), 30));
  get diagnostics v_b = row_count;

  if pg_catalog.to_regclass('public.platform_insights') is not null then
    execute pg_catalog.format(
      'delete from public.platform_insights where (state in (%L, %L, %L) and valid_until < pg_catalog.now() - pg_catalog.make_interval(days => %s)) or (state in (%L, %L) and updated_at < pg_catalog.now() - pg_catalog.make_interval(days => %s))',
      'new', 'seen', 'snoozed', greatest(coalesce(p_expired_grace_days, 7), 0),
      'dismissed', 'accepted', greatest(coalesce(p_closed_retention_days, 90), 30)
    );
    get diagnostics v_c = row_count;
  end if;

  v_total := v_a + v_b + v_c;
  return v_total;
end;
$$;

-- Yalniz service_role: tum fonksiyonlarda anon/authenticated/public EXECUTE kapali (statik sozlesme: yalniz from public yetmez).
revoke all on function public.insight_quiet_valuable_customers(uuid, int, int) from public, anon, authenticated;
grant execute on function public.insight_quiet_valuable_customers(uuid, int, int) to service_role;
revoke all on function public.insight_stalled_deals(uuid, int, int) from public, anon, authenticated;
grant execute on function public.insight_stalled_deals(uuid, int, int) to service_role;
revoke all on function public.insight_weekly_series(uuid, text, int) from public, anon, authenticated;
grant execute on function public.insight_weekly_series(uuid, text, int) to service_role;
revoke all on function public.insight_stale_listings(uuid, int, int) from public, anon, authenticated;
grant execute on function public.insight_stale_listings(uuid, int, int) to service_role;
revoke all on function public.insight_deadlines(uuid, int, int) from public, anon, authenticated;
grant execute on function public.insight_deadlines(uuid, int, int) to service_role;
revoke all on function public.insight_housekeeping(int, int) from public, anon, authenticated;
grant execute on function public.insight_housekeeping(int, int) to service_role;

revoke all on public.insight_rule_quality from public, anon, authenticated;
grant select on public.insight_rule_quality to service_role;

notify pgrst, 'reload schema';

-- DOGRULAMA (salt-okunur; yalniz yapi, veri okumaz):
-- select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'insight\_%' and prosecdef) as fn,
--        has_function_privilege('authenticated', 'public.insight_stalled_deals(uuid,int,int)', 'execute') as auth_rpc,
--        to_regclass('public.insight_rule_quality') is not null as quality_view;
-- Beklenen: 8 (set_state dahil) | f | t
