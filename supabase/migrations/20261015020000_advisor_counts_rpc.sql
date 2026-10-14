-- MIGRATION 20261015020000_advisor_counts_rpc.sql
-- KQ5 (2026-10-15): danisman basina musteri / yayindaki portfoy sayimi TEK turda.
-- Geri alma: supabase/rollbacks/20261015020000_advisor_counts_rpc.rollback.sql
-- BAGIMLILIK: public.customers, public.properties (assigned_to, deleted_at, is_sample, status, tenant_id).
--
-- AMAC: src/lib/team/advisor-metrics.ts `countPerAdvisor` kucuk ekipte danisman BASINA iki head-count istegi atiyordu
--   (Ekip Ligi / Danisman KPI / Kiyas / ana ekran ekip karti: 10 danismanda 20 PostgREST turu). Burada iki tablo
--   kimlik listesine gore tek sorguda GROUP BY ile sayilir. Kod RPC yokken (migration uygulanmadi) eski tek-tarama yoluna duser.
--
-- GUVENLIK: SECURITY INVOKER (RLS cagiranin yetkisiyle; gorulmeyen satir sayilmaz). Parametreler yalniz DARALTIR:
--   p_tenant_id verilirse tenant_id esitligi (service_role cagirani icin kiraci siniri), p_include_sample=false ise
--   is_sample=false (KPI ornek veri kurali, src/lib/sample-scope.ts ile ayni), p_live_statuses yayindaki durum degerleri.
-- ETKI: yalniz yeni fonksiyon (ek). Tablo/politika/veri degismez. Idempotent (create or replace).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.customers') is null or pg_catalog.to_regclass('public.properties') is null then
    raise exception 'public.customers/properties yok.';
  end if;
end $$;

create or replace function public.advisor_counts(
  p_ids uuid[],
  p_tenant_id uuid default null,
  p_include_sample boolean default false,
  p_live_statuses text[] default array['live', 'Yayında']
)
returns table (profile_id uuid, customers integer, live_properties integer)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with ids as (
    select distinct x.id
    from unnest(coalesce(p_ids, '{}'::uuid[])) as x(id)
    where x.id is not null
    limit 1000
  ),
  c as (
    select cu.assigned_to as id, count(*)::integer as n
    from public.customers cu
    where cu.assigned_to in (select ids.id from ids)
      and cu.deleted_at is null
      and (p_include_sample or cu.is_sample = false)
      and (p_tenant_id is null or cu.tenant_id = p_tenant_id)
    group by cu.assigned_to
  ),
  p as (
    select pr.assigned_to as id, count(*)::integer as n
    from public.properties pr
    where pr.assigned_to in (select ids.id from ids)
      and pr.deleted_at is null
      and pr.status = any(coalesce(p_live_statuses, '{}'::text[]))
      and (p_include_sample or pr.is_sample = false)
      and (p_tenant_id is null or pr.tenant_id = p_tenant_id)
    group by pr.assigned_to
  )
  select ids.id, coalesce(c.n, 0), coalesce(p.n, 0)
  from ids
  left join c on c.id = ids.id
  left join p on p.id = ids.id;
$$;

revoke all on function public.advisor_counts(uuid[], uuid, boolean, text[]) from public, anon;
grant execute on function public.advisor_counts(uuid[], uuid, boolean, text[]) to authenticated, service_role;

comment on function public.advisor_counts(uuid[], uuid, boolean, text[]) is
  'KQ5: danisman basina atanmis (silinmemis) musteri ve yayindaki portfoy sayisi tek turda (SECURITY INVOKER, RLS gecerli).';

notify pgrst, 'reload schema';
