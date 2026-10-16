-- MIGRATION 20261020010003_customer_heat_engagement.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kod yeni kolonlar yokken (eski RPC) dijital ilgi puanini 0 sayar;
--   yeni RPC'yi eski kod okursa ek kolonlari yok sayar.
-- Geri alma: supabase/rollbacks/20261020010003_customer_heat_engagement.rollback.sql (eski govdeler aynen geri kurulur).
-- BAGIMLILIK: 20261020010002 (communications.origin), assert_current_tenant, presentations.customer_id (20260727000113),
--   customer_portal_tokens.last_seen_at, portal_match_feedback, portal_customer_requests (20261007000620),
--   portal_demand_updates (20261012000200).
--
-- NE (CRM-G10, davranissal skor): customer_heat_signals donusune dijital ilgi sinyalleri eklenir (TEK okuyucu
--   src/lib/customer-state: liste rozeti, havuz sayimi, 360 ve "bugun ara" AYNI sonucu gorur):
--     presentations_viewed_7d  son 7 gunde acilan sunum sayisi (presentations.last_viewed_at)
--     portal_seen_at           musteri portalina son giris (customer_portal_tokens.last_seen_at)
--     portal_requests_14d      son 14 gunde portaldan gelen istek (teklif/randevu degisikligi + arayis guncelleme)
--     engaged_at               en yeni dijital ilgi ani (sunum acilisi, portal girisi, begeni, portal istegi)
--   Ayrica 20261020010002'nin aktardigi "Onceki notlar" kaydi (origin = 'customers.notes') son temas ve iletisim
--   sayisina GIRMEZ (customer_lead_signals da ayni kuralla yeniden tanimlanir; imza ve donus degismez).
-- Donus tipi degistigi icin customer_heat_signals DROP + CREATE (yetki kalibi aynen: SECURITY DEFINER +
--   assert_current_tenant + yalniz authenticated/service_role).
set local lock_timeout = '5s';

drop function if exists public.customer_heat_signals(uuid, uuid[]);

create function public.customer_heat_signals(
  p_tenant_id uuid,
  p_customer_ids uuid[]
)
returns table(
  customer_id uuid,
  last_contact timestamptz,
  open_demands int,
  urgent_demands int,
  portal_likes_30d int,
  open_offers int,
  open_deals int,
  presentations_viewed_7d int,
  portal_seen_at timestamptz,
  portal_requests_14d int,
  engaged_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    greatest(m.last_at, a.last_at, ca.last_at),
    coalesce(d.cnt, 0)::int,
    coalesce(d.urgent, 0)::int,
    coalesce(pf.cnt, 0)::int,
    coalesce(o.cnt, 0)::int,
    coalesce(dl.cnt, 0)::int,
    coalesce(pr.cnt_7d, 0)::int,
    pt.last_seen,
    (coalesce(rq.cnt, 0) + coalesce(du.cnt, 0))::int,
    greatest(pr.last_at, pt.last_seen, pf.last_at, rq.last_at, du.last_at)
  from public.customers c
  left join (
    select cd.customer_id,
           count(*) as cnt,
           count(*) filter (where cd.urgency in ('high', 'urgent')) as urgent
    from public.customer_demands cd
    where cd.tenant_id = public.assert_current_tenant(p_tenant_id)
      and cd.customer_id = any(p_customer_ids)
      and cd.status in ('new', 'active', 'matched')
    group by cd.customer_id
  ) d on d.customer_id = c.id
  left join (
    select cm.customer_id, max(cm.created_at) as last_at
    from public.communications cm
    where cm.tenant_id = public.assert_current_tenant(p_tenant_id)
      and cm.customer_id = any(p_customer_ids)
      and cm.origin is distinct from 'customers.notes'
    group by cm.customer_id
  ) m on m.customer_id = c.id
  left join (
    select ap.customer_id, max(ap.scheduled_at) as last_at
    from public.appointments ap
    where ap.tenant_id = public.assert_current_tenant(p_tenant_id)
      and ap.customer_id = any(p_customer_ids)
    group by ap.customer_id
  ) a on a.customer_id = c.id
  left join (
    select cl.customer_id, max(cl.started_at) as last_at
    from public.calls cl
    where cl.tenant_id = public.assert_current_tenant(p_tenant_id)
      and cl.customer_id = any(p_customer_ids)
    group by cl.customer_id
  ) ca on ca.customer_id = c.id
  left join (
    select pmf.customer_id,
           count(*) filter (where pmf.created_at >= now() - interval '30 days') as cnt,
           max(pmf.created_at) as last_at
    from public.portal_match_feedback pmf
    where pmf.tenant_id = public.assert_current_tenant(p_tenant_id)
      and pmf.customer_id = any(p_customer_ids)
      and pmf.verdict = 'liked'
      and pmf.created_at >= now() - interval '30 days'
    group by pmf.customer_id
  ) pf on pf.customer_id = c.id
  left join (
    select o.customer_id, count(*) as cnt
    from public.offers o
    where o.tenant_id = public.assert_current_tenant(p_tenant_id)
      and o.customer_id = any(p_customer_ids)
      and o.status in ('draft', 'submitted', 'countered')
    group by o.customer_id
  ) o on o.customer_id = c.id
  left join (
    select d0.customer_id, count(*) as cnt
    from public.deals d0
    where d0.tenant_id = public.assert_current_tenant(p_tenant_id)
      and d0.customer_id = any(p_customer_ids)
      and d0.stage in ('new', 'qualified', 'negotiation')
    group by d0.customer_id
  ) dl on dl.customer_id = c.id
  left join (
    select p.customer_id,
           count(*) filter (where p.last_viewed_at >= now() - interval '7 days') as cnt_7d,
           max(p.last_viewed_at) as last_at
    from public.presentations p
    where p.tenant_id = public.assert_current_tenant(p_tenant_id)
      and p.customer_id = any(p_customer_ids)
      and p.last_viewed_at >= now() - interval '30 days'
    group by p.customer_id
  ) pr on pr.customer_id = c.id
  left join (
    select t.customer_id, max(t.last_seen_at) as last_seen
    from public.customer_portal_tokens t
    where t.tenant_id = public.assert_current_tenant(p_tenant_id)
      and t.customer_id = any(p_customer_ids)
      and t.last_seen_at >= now() - interval '30 days'
    group by t.customer_id
  ) pt on pt.customer_id = c.id
  left join (
    select r.customer_id, count(*) as cnt, max(r.created_at) as last_at
    from public.portal_customer_requests r
    where r.tenant_id = public.assert_current_tenant(p_tenant_id)
      and r.customer_id = any(p_customer_ids)
      and r.created_at >= now() - interval '14 days'
    group by r.customer_id
  ) rq on rq.customer_id = c.id
  left join (
    select u.customer_id, count(*) as cnt, max(u.created_at) as last_at
    from public.portal_demand_updates u
    where u.tenant_id = public.assert_current_tenant(p_tenant_id)
      and u.customer_id = any(p_customer_ids)
      and u.created_at >= now() - interval '14 days'
    group by u.customer_id
  ) du on du.customer_id = c.id
  where c.tenant_id = public.assert_current_tenant(p_tenant_id)
    and c.id = any(p_customer_ids)
    and c.deleted_at is null;
$$;

comment on function public.customer_heat_signals(uuid, uuid[]) is
  'Musteri isi sinyalleri (son temas, talep, begeni, teklif/anlasma) + CRM-G10 dijital ilgi (sunum acilisi, portal girisi, '
  'portal istegi, en yeni ilgi ani). Okuyucu: src/lib/customer-state/load.ts.';

revoke all privileges on function public.customer_heat_signals(uuid, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.customer_heat_signals(uuid, uuid[])
  to authenticated, service_role;

-- Aday sinyalleri: imza/donus ayni; yalniz aktarilan eski not iletisim sayisina ve son etkilesime girmez.
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
      and cm.origin is distinct from 'customers.notes'
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
