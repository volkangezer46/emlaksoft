-- MIGRATION 20261019090000_insight_stalled_deals_stage.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- Geri alma: supabase/rollbacks/20261019090000_insight_stalled_deals_stage.rollback.sql
-- BAGIMLILIK: 20260826002700 (insight_stalled_deals ilk govdesi), 20261018080000 (deals.stage_changed_at / expected_close_date).
--
-- AMAC (B9, A8 artigi): "riskli anlasma" icgorusu (deal_risk@1) hareketsizligi deals.updated_at'ten hesapliyordu; not eklemek
--   ya da bir alani duzenlemek anlasmayi "taze" yapiyordu. Anlasma listesi (?bayat=1) ve ana ekran SP1'den beri asamada gecen
--   gunu (stage_changed_at) kullanir; icgoru de ayni olcuye gecer ve beklenen kapanis tarihi (expected_close_date) gecmis acik
--   anlasmalari da aday yapar.
--  * idle_days = simdi - coalesce(stage_changed_at, updated_at, created_at) (eski satirda stage_changed_at bossa eski vekil).
--  * Aday: hareketsizlik esigi asilmis YA DA beklenen kapanis tarihi bugunden (TR) once olan acik anlasma.
--  * Donus tablosuna stage_changed_at, expected_close_date, close_overdue_days eklenir (donus tipi degistigi icin
--    DROP + CREATE; imza ve yetki ayni: yalniz service_role).
-- GUVENLIK: SECURITY DEFINER + search_path '' (ilk govdeyle ayni); yalniz service_role calistirir (icgoru motoru cron'u),
--   p_tenant_id kosulu her alt sorguda; authenticated/anon calistiramaz.
-- ETKI: davranis (icgoru adaylari degisir). KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kod yeni kolonlar yoksa eski
--   olcuyle calisir, eski kod yeni kolonlari yok sayar. Idempotent.
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.deals') is null then
    raise exception '20261019090000: public.deals yok.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.deals'::regclass and attname = 'stage_changed_at' and not attisdropped
  ) or not exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.deals'::regclass and attname = 'expected_close_date' and not attisdropped
  ) then
    raise exception '20261019090000: deals.stage_changed_at / expected_close_date yok (once 20261018080000).';
  end if;
end $$;

drop function if exists public.insight_stalled_deals(uuid, int, int);

create function public.insight_stalled_deals(
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
  property_code text,
  stage_changed_at timestamptz,
  expected_close_date date,
  close_overdue_days int
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select
      d.*,
      coalesce(d.stage_changed_at, d.updated_at, d.created_at) as idle_from,
      ((pg_catalog.now() at time zone 'Europe/Istanbul')::date - d.expected_close_date) as overdue
    from public.deals d
    where d.tenant_id = p_tenant_id
      and d.is_sample = false
      and d.assigned_to is not null
      and d.stage not in ('won', 'lost')
  )
  select
    d.id, d.assigned_to, d.stage, d.deal_type, d.created_at, d.updated_at,
    floor(extract(epoch from (pg_catalog.now() - d.idle_from)) / 86400)::int,
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
    d.deal_value, p.list_price, p.title, p.property_code,
    d.stage_changed_at,
    d.expected_close_date,
    case when d.overdue > 0 then d.overdue else 0 end
  from base d
  left join public.properties p on p.id = d.property_id and p.tenant_id = p_tenant_id
  where d.idle_from <= pg_catalog.now() - pg_catalog.make_interval(days => greatest(coalesce(p_min_idle_days, 14), 1))
     or d.overdue > 0
  order by d.idle_from asc
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

revoke all on function public.insight_stalled_deals(uuid, int, int) from public, anon, authenticated;
grant execute on function public.insight_stalled_deals(uuid, int, int) to service_role;
