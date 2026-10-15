-- Geri alma: 20261017010400_finance_pnl_v3.sql
-- Uc parametreli (p_basis) finance_pnl / finance_vat_summary duser; iki parametreli surumler 20261016060100 govdeleriyle BIREBIR
-- geri gelir (ACL ayni: authenticated + service_role). Kod {p_from, p_to} ile cagirdigindan uyumludur; 'nakit' esasi kalkar.
set local lock_timeout = '5s';

drop function if exists public.finance_pnl(date, date, text);
drop function if exists public.finance_vat_summary(date, date, text);

create or replace function public.finance_pnl(p_from date, p_to date)
returns table(month date, income numeric, expense numeric, net numeric, income_by_category jsonb, expense_by_category jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('view');
  v_gm boolean := public.finance_is_owner_gm();
  v_m1 date;
  v_m2 date;
begin
  if p_from is null or p_to is null or p_from > p_to then perform public.finance_v2_raise('invalid_input'); end if;
  v_m1 := pg_catalog.date_trunc('month', p_from)::date;
  v_m2 := pg_catalog.date_trunc('month', p_to)::date;
  if v_m2 > (v_m1 + interval '36 months')::date then perform public.finance_v2_raise('invalid_input'); end if;

  return query
  with months as (
    select g.m::date as m from pg_catalog.generate_series(v_m1::timestamp, v_m2::timestamp, interval '1 month') g(m)
  ),
  lines as (
    -- gross_amount KDV HARIC matrahtir; KDV (vat_amount) burada DUSULMEZ (yalniz Vergi sekmesinde bilgi/beyan).
    select pg_catalog.date_trunc('month', (c.created_at at time zone 'Europe/Istanbul'))::date as lm, 'in'::text as side,
           'komisyon'::text as cat,
           c.gross_amount
             - coalesce((select sum(s.amount) from public.commission_splits s
                          where s.commission_id = c.id and s.tenant_id = c.tenant_id and s.kind <> 'office'), 0) as amt
      from public.commissions c
     where c.tenant_id = v_tenant and c.status <> 'cancelled' and c.is_sample = false
       and (c.created_at at time zone 'Europe/Istanbul')::date >= v_m1
       and (c.created_at at time zone 'Europe/Istanbul')::date < (v_m2 + interval '1 month')::date
    union all
    select pg_catalog.date_trunc('month', rp.paid_on)::date, 'in', 'kira_yonetimi', rp.management_fee
      from public.rent_payments rp
     where rp.tenant_id = v_tenant and rp.voided_at is null and rp.management_fee > 0
       and rp.paid_on >= v_m1 and rp.paid_on < (v_m2 + interval '1 month')::date
    union all
    select pg_catalog.date_trunc('month', e.entry_date)::date, e.direction, coalesce(e.category, case when e.direction = 'in' then 'diger_gelir' else 'diger_gider' end),
           e.amount + coalesce(e.withholding_amount, 0) - coalesce(e.vat_amount, 0)
      from public.cash_entries e
      join public.finance_accounts a on a.id = e.account_id and a.tenant_id = e.tenant_id and a.owner_scope = 'office'
     where e.tenant_id = v_tenant and e.voided_at is null and e.is_sample = false and e.currency = 'TRY'
       and e.entry_date >= v_m1 and e.entry_date < (v_m2 + interval '1 month')::date
       and (
         (e.kind = 'income' and e.source_type = 'manual'
           and coalesce(e.category, '') not in ('komisyon', 'kira_tahsilat', 'aidat_tahsilat', 'kira_yonetimi', 'transfer'))
         or (e.kind = 'expense' and e.expense_id is null and e.source_type <> 'owner_payout'
           and coalesce(e.category, '') not in ('transfer', 'mulk_sahibi_odeme'))
       )
       and (e.category is distinct from 'maas' or v_gm)
    union all
    select pg_catalog.date_trunc('month', x.expense_date)::date, 'out', x.category::text, x.amount
      from public.expenses x
     where x.tenant_id = v_tenant and x.is_sample = false
       and x.expense_date >= v_m1 and x.expense_date < (v_m2 + interval '1 month')::date
       and not exists (select 1 from public.owner_charge_links l where l.kind = 'expense' and l.ref_id = x.id and l.tenant_id = x.tenant_id)
  ),
  cat as (
    select l.lm, l.side, l.cat, sum(l.amt) as amt from lines l group by l.lm, l.side, l.cat
  )
  select mo.m,
         coalesce(sum(c.amt) filter (where c.side = 'in'), 0)::numeric,
         coalesce(sum(c.amt) filter (where c.side = 'out'), 0)::numeric,
         (coalesce(sum(c.amt) filter (where c.side = 'in'), 0) - coalesce(sum(c.amt) filter (where c.side = 'out'), 0))::numeric,
         coalesce(jsonb_object_agg(c.cat, c.amt) filter (where c.side = 'in'), '{}'::jsonb),
         coalesce(jsonb_object_agg(c.cat, c.amt) filter (where c.side = 'out'), '{}'::jsonb)
    from months mo
    left join cat c on c.lm = mo.m
   group by mo.m
   order by mo.m;
end;
$$;

create or replace function public.finance_vat_summary(p_from date, p_to date)
returns table(month date, output_vat numeric, input_vat numeric, payable numeric, withholding_paid numeric, withholding_collected numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('view');
  v_gm boolean := public.finance_is_owner_gm();
  v_m1 date;
  v_m2 date;
begin
  if p_from is null or p_to is null or p_from > p_to then perform public.finance_v2_raise('invalid_input'); end if;
  v_m1 := pg_catalog.date_trunc('month', p_from)::date;
  v_m2 := pg_catalog.date_trunc('month', p_to)::date;
  if v_m2 > (v_m1 + interval '36 months')::date then perform public.finance_v2_raise('invalid_input'); end if;

  return query
  with months as (
    select g.m::date as m from pg_catalog.generate_series(v_m1::timestamp, v_m2::timestamp, interval '1 month') g(m)
  ),
  -- KDV'si duzenleme ayinda sayilan acik kalemler (iptal edilmemis, ornek olmayan, KDV > 0, TRY).
  oi as (
    select o.id, pg_catalog.date_trunc('month', o.issue_date)::date as om, o.direction, o.vat_amount as vat
      from public.finance_open_items o
     where o.tenant_id = v_tenant and o.cancelled_at is null and o.is_sample = false and o.currency = 'TRY'
       and coalesce(o.vat_amount, 0) > 0
       and (o.category is distinct from 'maas' or v_gm)
  ),
  ent as (
    select pg_catalog.date_trunc('month', e.entry_date)::date as em, e.direction, e.source_type,
           -- KDV'si kalemden (duzenleme ayi) sayilan kaleme bagli hareketin KDV'si ikinci kez sayilmaz.
           case when e.open_item_id is not null
                     and exists (select 1 from oi where oi.id = e.open_item_id)
                then 0 else coalesce(e.vat_amount, 0) end as vat,
           coalesce(e.withholding_amount, 0) as wh
      from public.cash_entries e
      join public.finance_accounts a on a.id = e.account_id and a.tenant_id = e.tenant_id and a.owner_scope = 'office'
     where e.tenant_id = v_tenant and e.voided_at is null and e.currency = 'TRY' and e.kind in ('income', 'expense')
       and e.entry_date >= v_m1 and e.entry_date < (v_m2 + interval '1 month')::date
       and (e.category is distinct from 'maas' or v_gm)
  ),
  com as (
    select pg_catalog.date_trunc('month', (c.created_at at time zone 'Europe/Istanbul'))::date as cm, coalesce(c.vat_amount, 0) as vat
      from public.commissions c
     where c.tenant_id = v_tenant and c.status <> 'cancelled' and c.is_sample = false
       and (c.created_at at time zone 'Europe/Istanbul')::date >= v_m1
       and (c.created_at at time zone 'Europe/Istanbul')::date < (v_m2 + interval '1 month')::date
  ),
  agg as (
    select mo.m,
           coalesce((select sum(x.vat) from ent x where x.em = mo.m and x.direction = 'in' and x.source_type <> 'commission'), 0)
             + coalesce((select sum(c.vat) from com c where c.cm = mo.m), 0)
             + coalesce((select sum(o.vat) from oi o where o.om = mo.m and o.direction = 'receivable'), 0) as out_vat,
           coalesce((select sum(x.vat) from ent x where x.em = mo.m and x.direction = 'out'), 0)
             + coalesce((select sum(o.vat) from oi o where o.om = mo.m and o.direction = 'payable'), 0) as in_vat,
           coalesce((select sum(x.wh) from ent x where x.em = mo.m and x.direction = 'out'), 0) as wh_paid,
           coalesce((select sum(x.wh) from ent x where x.em = mo.m and x.direction = 'in'), 0) as wh_coll
      from months mo
  )
  select a.m, a.out_vat::numeric, a.in_vat::numeric, (a.out_vat - a.in_vat)::numeric, a.wh_paid::numeric, a.wh_coll::numeric
    from agg a
   order by a.m;
end;
$$;

revoke all on function public.finance_pnl(date, date) from public, anon;
grant execute on function public.finance_pnl(date, date) to authenticated, service_role;
revoke all on function public.finance_vat_summary(date, date) from public, anon;
grant execute on function public.finance_vat_summary(date, date) to authenticated, service_role;
