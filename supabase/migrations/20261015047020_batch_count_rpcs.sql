-- MIGRATION 20261015047020_batch_count_rpcs.sql
-- YD7 (2026-10-15): N+1 ve sayim fan-out'u tek sorguya iner.
-- Geri alma: supabase/rollbacks/20261015047020_batch_count_rpcs.rollback.sql
-- BAGIMLILIK: public.customers / deals / appointments / calls / communications / offers / tasks / iys_consents /
--   customer_demands / properties ve public.ef_credit_balance(uuid) (20260826000100 + 20261010000300).
--
-- AMAC (kalite kesfi bulgulari):
--   * Platform KVKK taramasi (src/lib/compliance/platform-kvkk-service.ts) eslesen HER musteri x 7 iliskili tablo icin ayri
--     head-count atiyordu (100 musteride 700 istek)              -> kvkk_customer_related_counts (tek sorgu, yalniz service_role)
--   * Admin analiz bakiyesi listesi (src/lib/ef-credits/admin-data.ts) ofis BASINA ef_credit_balance cagiriyordu
--                                                              -> ef_credit_balances (ayni govdeyi ofis listesiyle tek turda)
--   * /app/teklifler 7 head-count (toplam + 6 durum)            -> offer_counts
--   * /app/talepler 7 head-count (4 durum + acil/yuksek + yaslanan) -> demand_counts
--   * /app/hedefler hedef BASINA 2 head-count (randevu / yeni portfoy) -> target_activity_counts
--   Kod fonksiyon yokken (migration uygulanmadi) eski sorgulara duser (rpc-probe deseni); sahte sifir uretilmez.
--
-- GUVENLIK:
--   * offer_counts / demand_counts / target_activity_counts: SECURITY INVOKER, yalniz authenticated. RLS cagiranin yetkisiyle
--     uygulanir (sayfadaki PostgREST sorgusunun gordugu satirlar = sayilan satirlar). Parametreler yalniz DARALTIR.
--   * kvkk_customer_related_counts / ef_credit_balances: yalniz service_role (platform ekranlari service_role ile okur;
--     ef_credit_balance zaten service_role denetler).
-- ETKI: yalniz 5 yeni fonksiyon (ek). Tablo/politika/veri degismez. Idempotent (create or replace).

set local lock_timeout = '5s';

do $$
declare
  t text;
begin
  foreach t in array array['customers', 'deals', 'appointments', 'calls', 'communications', 'offers', 'tasks', 'iys_consents',
                           'customer_demands', 'properties'] loop
    if pg_catalog.to_regclass('public.' || t) is null then
      raise exception 'public.% yok.', t;
    end if;
  end loop;
  if pg_catalog.to_regprocedure('public.ef_credit_balance(uuid)') is null then
    raise exception 'public.ef_credit_balance(uuid) yok.';
  end if;
end $$;

-- 1) KVKK: musteri x iliskili tablo sayimi (yalniz sifirdan buyuk satirlar doner).
create or replace function public.kvkk_customer_related_counts(p_customer_ids uuid[])
returns table (customer_id uuid, tbl text, n bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with c as (
    select cu.id, cu.tenant_id
    from public.customers cu
    where cu.id = any(coalesce(p_customer_ids, '{}'::uuid[]))
    limit 1000
  )
  select c.id, 'deals'::text, count(*)::bigint from public.deals x join c on x.customer_id = c.id and x.tenant_id = c.tenant_id group by c.id
  union all
  select c.id, 'appointments', count(*) from public.appointments x join c on x.customer_id = c.id and x.tenant_id = c.tenant_id group by c.id
  union all
  select c.id, 'calls', count(*) from public.calls x join c on x.customer_id = c.id and x.tenant_id = c.tenant_id group by c.id
  union all
  select c.id, 'communications', count(*) from public.communications x join c on x.customer_id = c.id and x.tenant_id = c.tenant_id group by c.id
  union all
  select c.id, 'offers', count(*) from public.offers x join c on x.customer_id = c.id and x.tenant_id = c.tenant_id group by c.id
  union all
  select c.id, 'tasks', count(*) from public.tasks x join c on x.customer_id = c.id and x.tenant_id = c.tenant_id group by c.id
  union all
  select c.id, 'iys_consents', count(*) from public.iys_consents x join c on x.customer_id = c.id and x.tenant_id = c.tenant_id group by c.id;
$$;

revoke all on function public.kvkk_customer_related_counts(uuid[]) from public, anon, authenticated;
grant execute on function public.kvkk_customer_related_counts(uuid[]) to service_role;

comment on function public.kvkk_customer_related_counts(uuid[]) is
  'YD7: platform KVKK taramasi; musteri basina 7 iliskili tablodaki kayit sayisi tek sorguda (yalniz service_role).';

-- 2) Analiz (EF) bakiyesi: ofis listesi icin tek tur. Govde ef_credit_balance'in KENDISI (tek kaynak).
create or replace function public.ef_credit_balances(p_tenants uuid[])
returns table (tenant_id uuid, balance jsonb)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select t.id, public.ef_credit_balance(t.id)
  from (
    select distinct x.id
    from unnest(coalesce(p_tenants, '{}'::uuid[])) as x(id)
    where x.id is not null
    limit 200
  ) t;
$$;

revoke all on function public.ef_credit_balances(uuid[]) from public, anon, authenticated;
grant execute on function public.ef_credit_balances(uuid[]) to service_role;

comment on function public.ef_credit_balances(uuid[]) is
  'YD7: ef_credit_balance ofis listesiyle tek turda (en cok 200; yalniz service_role).';

-- 3) /app/teklifler sayaçlari: toplam + duruma gore (RLS gecerli).
create or replace function public.offer_counts(p_created_by uuid default null)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select case when auth.uid() is null then null else (
    select jsonb_build_object(
      'total', coalesce(sum(s.n), 0),
      'by_status', coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
    )
    from (
      select o.status::text as status, count(*)::bigint as n
      from public.offers o
      where p_created_by is null or o.created_by = p_created_by
      group by o.status
    ) s
  ) end;
$$;

revoke all on function public.offer_counts(uuid) from public, anon;
grant execute on function public.offer_counts(uuid) to authenticated;

comment on function public.offer_counts(uuid) is
  'YD7: /app/teklifler toplam + durum sayaclari tek sorguda (SECURITY INVOKER, RLS gecerli).';

-- 4) /app/talepler sayaçlari. Danisman/kapsam musteri uzerinden (customers.assigned_to; PostgREST !inner gommesiyle ayni:
--    kapsam varken musterisi gorunmeyen talep sayilmaz).
create or replace function public.demand_counts(
  p_owner_ids uuid[] default null,
  p_advisor uuid default null,
  p_open_statuses text[] default array['new', 'active', 'matched'],
  p_aging_before timestamptz default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select case when auth.uid() is null then null else (
    select jsonb_build_object(
      'new', count(*) filter (where d.status = 'new'),
      'active', count(*) filter (where d.status = 'active'),
      'matched', count(*) filter (where d.status = 'matched'),
      'closed', count(*) filter (where d.status = 'closed'),
      'urgent', count(*) filter (where d.status = any(p_open_statuses) and d.urgency = 'urgent'),
      'high', count(*) filter (where d.status = any(p_open_statuses) and d.urgency = 'high'),
      'aging', count(*) filter (where d.status = any(p_open_statuses) and p_aging_before is not null and d.created_at <= p_aging_before)
    )
    from public.customer_demands d
    where (p_owner_ids is null and p_advisor is null)
       or exists (
         select 1 from public.customers c
         where c.id = d.customer_id
           and (p_owner_ids is null or c.assigned_to = any(p_owner_ids))
           and (p_advisor is null or c.assigned_to = p_advisor)
       )
  ) end;
$$;

revoke all on function public.demand_counts(uuid[], uuid, text[], timestamptz) from public, anon;
grant execute on function public.demand_counts(uuid[], uuid, text[], timestamptz) to authenticated;

comment on function public.demand_counts(uuid[], uuid, text[], timestamptz) is
  'YD7: /app/talepler durum/aciliyet/yaslanan sayaclari tek sorguda (SECURITY INVOKER, RLS gecerli).';

-- 5) /app/hedefler faaliyet gerceklesmesi: hedef basina randevu (iptal olmayan, donemde planlanan) + yeni portfoy
--    (donemde eklenen, silinmemis, ornek veri haric). Danisman hedefinde assigned_to suzgeci; en cok 200 hedef.
create or replace function public.target_activity_counts(p_tenant_id uuid, p_items jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select case when auth.uid() is null or p_tenant_id is null then null else (
    select coalesce(jsonb_object_agg(i.id, jsonb_build_object(
      'appointments', case when coalesce(i.want_appointments, false) then (
        select count(*) from public.appointments a
        where a.tenant_id = p_tenant_id
          and a.status <> 'cancelled'
          and a.scheduled_at >= i.start_at and a.scheduled_at < i.end_at
          and (i.profile_id is null or a.assigned_to = i.profile_id)
      ) end,
      'listings', case when coalesce(i.want_listings, false) then (
        select count(*) from public.properties p
        where p.tenant_id = p_tenant_id
          and p.deleted_at is null
          and p.is_sample = false
          and p.created_at >= i.start_at and p.created_at < i.end_at
          and (i.profile_id is null or p.assigned_to = i.profile_id)
      ) end
    )), '{}'::jsonb)
    from (
      select r.*
      from jsonb_to_recordset(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end)
        as r(id text, start_at timestamptz, end_at timestamptz, profile_id uuid, want_appointments boolean, want_listings boolean)
      where r.id is not null and r.start_at is not null and r.end_at is not null
      limit 200
    ) i
  ) end;
$$;

revoke all on function public.target_activity_counts(uuid, jsonb) from public, anon;
grant execute on function public.target_activity_counts(uuid, jsonb) to authenticated;

comment on function public.target_activity_counts(uuid, jsonb) is
  'YD7: /app/hedefler hedef basina randevu/yeni portfoy gerceklesmesi tek sorguda (SECURITY INVOKER, RLS gecerli).';

notify pgrst, 'reload schema';
