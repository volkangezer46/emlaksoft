-- 20261019090000 geri alma: insight_stalled_deals ilk govdesine (20260826002700) doner: hareketsizlik yeniden updated_at'ten,
--   beklenen kapanis adaylari duser. Kod yeni kolonlar yokken eski olcuyle calisir.
set local lock_timeout = '5s';

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

revoke all on function public.insight_stalled_deals(uuid, int, int) from public, anon, authenticated;
grant execute on function public.insight_stalled_deals(uuid, int, int) to service_role;
