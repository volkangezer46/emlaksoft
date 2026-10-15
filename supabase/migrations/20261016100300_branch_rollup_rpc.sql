-- MIGRATION 20261016100300_branch_rollup_rpc.sql
-- P5 (2026-10-16): /app/franchise (Sube karsilastirma) sube rollup'i TEK GROUP BY turunda.
-- Geri alma: supabase/rollbacks/20261016100300_branch_rollup_rpc.rollback.sql
-- BAGIMLILIK: public.properties / customers (branch_id, deleted_at), public.deals (assigned_to, stage, deal_value, created_at),
--   public.profiles (id, branch_id, is_active).
--
-- AMAC: src/app/app/franchise/page.tsx portfoy, musteri ve islem tablolarini fetchAllRows ile sayfa sayfa (1000'erli) tum
--   satirlariyla okuyup JS'de sayiyordu (buyuk ofiste onlarca PostgREST turu + satir tasima). Burada ayni katlama SQL'de:
--   * portfoy / musteri: silinmemis (deleted_at is null) satirlar branch_id'ye gore (ornek veri suzulmez; sayfayla ayni).
--   * islemler: donem [p_from, p_to] (her iki uc dahil, null = sinirsiz) created_at'e gore; sube = atanan danismanin AKTIF
--     profilindeki branch_id (aktif profil yoksa / atanmamissa null = "Subesiz"). deals_total tum asamalar, deals_won ve
--     won_value yalniz stage = 'won' (deal_value null -> 0).
--   branch_id null satiri "Subesiz" kovasidir; pasif/gorunmeyen sube kimlikleri cagiranda Subesiz'e katlanir (sayfa kurali).
--   Kod fonksiyon yokken (migration uygulanmadi) eski sayfali taramaya duser (rpc-probe deseni); sahte sifir uretilmez.
--
-- GUVENLIK: SECURITY INVOKER, yalniz authenticated. RLS cagiranin yetkisiyle uygulanir (sayfadaki PostgREST sorgularinin
--   gordugu satirlar = sayilan satirlar). Parametreler yalniz DARALTIR (donem).
-- ETKI: yalniz yeni fonksiyon (ek). Tablo/politika/veri degismez. Idempotent (create or replace).

set local lock_timeout = '5s';

do $$
declare
  t text;
begin
  foreach t in array array['properties', 'customers', 'deals', 'profiles'] loop
    if pg_catalog.to_regclass('public.' || t) is null then
      raise exception 'public.% yok.', t;
    end if;
  end loop;
end $$;

create or replace function public.branch_rollup(p_from timestamptz default null, p_to timestamptz default null)
returns table (branch_id uuid, properties integer, customers integer, deals_total integer, deals_won integer, won_value numeric)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with parts as (
    select pr.branch_id as b, count(*)::integer as props, 0 as custs, 0 as dt, 0 as dw, 0::numeric as wv
    from public.properties pr
    where pr.deleted_at is null
    group by pr.branch_id
    union all
    select cu.branch_id, 0, count(*)::integer, 0, 0, 0::numeric
    from public.customers cu
    where cu.deleted_at is null
    group by cu.branch_id
    union all
    select pf.branch_id,
           0,
           0,
           count(*)::integer,
           (count(*) filter (where d.stage = 'won'))::integer,
           coalesce(sum(coalesce(d.deal_value, 0)) filter (where d.stage = 'won'), 0)::numeric
    from public.deals d
    left join public.profiles pf on pf.id = d.assigned_to and pf.is_active = true
    where (p_from is null or d.created_at >= p_from)
      and (p_to is null or d.created_at <= p_to)
    group by pf.branch_id
  )
  select parts.b, sum(parts.props)::integer, sum(parts.custs)::integer, sum(parts.dt)::integer, sum(parts.dw)::integer,
         sum(parts.wv)::numeric
  from parts
  group by parts.b;
$$;

revoke all on function public.branch_rollup(timestamptz, timestamptz) from public, anon;
grant execute on function public.branch_rollup(timestamptz, timestamptz) to authenticated;

comment on function public.branch_rollup(timestamptz, timestamptz) is
  'P5: /app/franchise sube basina portfoy/musteri sayisi + donemdeki islem toplam/kazanilan ve kazanilan hacim tek turda (SECURITY INVOKER, RLS gecerli).';

notify pgrst, 'reload schema';
