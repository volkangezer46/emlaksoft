-- MIGRATION 20261012001700_portfolio_counts_rpc.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261012001700_portfolio_counts_rpc.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261012001700_portfolio_counts_rpc.rollback.sql
-- BAGIMLILIK: public.properties, public.tasks, public.current_tenant_id().
--
-- AMAC (HIZ-1): /app/portfoyler her acilista ayni properties tablosuna 10 ayri head-count turu atiyordu
--   (toplam, yayinda, bekleyen, taslak, satilik, kiralik, son 28 gun, saglik iyi/izle/riskli); /app/gorevler 10 sayim
--   (acik, geciken, bugun, yaklasan, biten, tum, 4 tur). Her biri ayri HTTP turu + ayri RLS plani. Burada her tablo
--   TEK taramada FILTER (WHERE ...) ile sayilir. Kod RPC yoksa/hata verirse eski sorgulara duser (rpc-probe deseni).
--
-- GUVENLIK: SECURITY INVOKER (RLS cagiranin yetkisiyle; kapsam disi satir sayilmaz). Ek olarak tenant_id = current_tenant_id().
--   Kapsam: p_owner_ids (uuid[]) = uygulamadaki applyScopeFilter'in cozdugu sahip listesi (self -> [uid], members -> ids,
--   none -> NULL = suzgec yok). Bu yalniz DARALTIR; RLS'i genisletemez. Durum/saglik deger kumeleri cagiran gonderir
--   (sayfadaki STATUS_DB_VALUES / SAGLIK_DB_VALUES ile birebir).
-- ETKI: yalniz 2 yeni fonksiyon (ek). Tablo/politika/veri degismez.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.properties') is null or pg_catalog.to_regclass('public.tasks') is null then
    raise exception 'public.properties/tasks yok.';
  end if;
  if pg_catalog.to_regprocedure('public.current_tenant_id()') is null then
    raise exception 'current_tenant_id() yok.';
  end if;
end $$;

create or replace function public.portfolio_counts(
  p_owner_ids uuid[] default null,
  p_live text[] default '{}',
  p_pending text[] default '{}',
  p_draft text[] default '{}',
  p_green text[] default '{}',
  p_yellow text[] default '{}',
  p_red text[] default '{}',
  p_recent_since timestamptz default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select case when auth.uid() is null or public.current_tenant_id() is null then null else (
    select jsonb_build_object(
      'total', count(*),
      'live', count(*) filter (where p.status = any(p_live)),
      'pending', count(*) filter (where p.status = any(p_pending)),
      'draft', count(*) filter (where p.status = any(p_draft)),
      'sale', count(*) filter (where p.transaction_type = 'Satılık'),
      'rent', count(*) filter (where p.transaction_type = 'Kiralık'),
      'recent', count(*) filter (where p_recent_since is not null and p.created_at >= p_recent_since),
      'green', count(*) filter (where p.price_health = any(p_green)),
      'yellow', count(*) filter (where p.price_health = any(p_yellow)),
      'red', count(*) filter (where p.price_health = any(p_red))
    )
    from public.properties p
    where p.tenant_id = public.current_tenant_id()
      and p.deleted_at is null
      and (p_owner_ids is null or p.assigned_to = any(p_owner_ids))
  ) end;
$$;

create or replace function public.task_counts(
  p_owner_ids uuid[] default null,
  p_now timestamptz default null,
  p_today_start timestamptz default null,
  p_today_end timestamptz default null,
  p_week_end timestamptz default null,
  p_kinds text[] default '{}'
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select case when auth.uid() is null or public.current_tenant_id() is null or p_now is null then null else (
    select jsonb_build_object(
      'all', count(*),
      'open', count(*) filter (where t.status = 'open'),
      'done', count(*) filter (where t.status = 'done'),
      'overdue', count(*) filter (where t.status = 'open' and t.due_at < p_now),
      'today', count(*) filter (where t.status = 'open' and t.due_at >= p_today_start and t.due_at <= p_today_end),
      'upcoming', count(*) filter (where t.status = 'open' and t.due_at >= p_now and t.due_at <= p_week_end),
      'kinds', coalesce((
        select jsonb_object_agg(k.kind, k.n)
        from (
          select t2.kind, count(*) as n
          from public.tasks t2
          where t2.tenant_id = public.current_tenant_id()
            and t2.status = 'open'
            and t2.kind = any(p_kinds)
            and (p_owner_ids is null or t2.assigned_to = any(p_owner_ids))
          group by t2.kind
        ) k
      ), '{}'::jsonb)
    )
    from public.tasks t
    where t.tenant_id = public.current_tenant_id()
      and (p_owner_ids is null or t.assigned_to = any(p_owner_ids))
  ) end;
$$;

notify pgrst, 'reload schema';
