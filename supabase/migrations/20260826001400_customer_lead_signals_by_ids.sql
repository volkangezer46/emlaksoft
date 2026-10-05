-- MIGRATION 20260826001400_customer_lead_signals_by_ids.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826001400_customer_lead_signals_by_ids.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826001400_customer_lead_signals_by_ids.rollback.sql
-- BAGIMLILIK: public.assert_current_tenant(uuid) ve eski customer_lead_signals(uuid) (20260731000133).
--
-- AMAC (P1): customer_lead_signals(p_tenant_id) tenant'taki TUM musterileri doner; PostgREST 1000 satirda keser
--   ve buyuk ofislerde skorlar sessizce eksik kalir. Yeni asiri yukleme yalniz verilen id'ler icin hesaplar
--   (customer_heat_signals(p_tenant_id, p_customer_ids) deseni). Eski imza KALIR (forward-only); istemci yeni
--   imza yoksa eskiye duser. Yetki kalibi aynen: SECURITY DEFINER + assert_current_tenant + authenticated/service_role.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('public.assert_current_tenant(uuid)') is null then
    raise exception 'assert_current_tenant(uuid) yok; once temel migrationlar uygulanmali.';
  end if;
  if pg_catalog.to_regprocedure('public.customer_lead_signals(uuid)') is null then
    raise exception 'customer_lead_signals(uuid) yok; once 20260731000133 uygulanmali.';
  end if;
end $$;

create or replace function public.customer_lead_signals(
  p_tenant_id uuid,
  p_customer_ids uuid[]
)
returns table(
  customer_id uuid,
  active_demands int,
  comms int,
  appts int,
  calls int,
  last_activity timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id,
    coalesce(d.cnt, 0)::int,
    coalesce(m.cnt, 0)::int,
    coalesce(a.cnt, 0)::int,
    coalesce(ca.cnt, 0)::int,
    greatest(m.last_at, a.last_at, ca.last_at)
  from public.customers c
  left join (
    select cd.customer_id, count(*) as cnt
    from public.customer_demands cd
    where cd.tenant_id = public.assert_current_tenant(p_tenant_id)
      and cd.customer_id = any(p_customer_ids)
      and cd.status in ('new', 'active', 'matched')
    group by cd.customer_id
  ) d on d.customer_id = c.id
  left join (
    select cm.customer_id, count(*) as cnt, max(cm.created_at) as last_at
    from public.communications cm
    where cm.tenant_id = public.assert_current_tenant(p_tenant_id)
      and cm.customer_id = any(p_customer_ids)
    group by cm.customer_id
  ) m on m.customer_id = c.id
  left join (
    select ap.customer_id, count(*) as cnt, max(ap.scheduled_at) as last_at
    from public.appointments ap
    where ap.tenant_id = public.assert_current_tenant(p_tenant_id)
      and ap.customer_id = any(p_customer_ids)
    group by ap.customer_id
  ) a on a.customer_id = c.id
  left join (
    select cl.customer_id, count(*) as cnt, max(cl.started_at) as last_at
    from public.calls cl
    where cl.tenant_id = public.assert_current_tenant(p_tenant_id)
      and cl.customer_id = any(p_customer_ids)
    group by cl.customer_id
  ) ca on ca.customer_id = c.id
  where c.tenant_id = public.assert_current_tenant(p_tenant_id)
    and c.id = any(p_customer_ids)
    and c.deleted_at is null;
$$;

revoke all privileges on function public.customer_lead_signals(uuid, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.customer_lead_signals(uuid, uuid[])
  to authenticated, service_role;
