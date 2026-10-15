-- 20261016060100 geri alma: finance_pnl, finance_vat_summary, finance_open_item_settle ve finance_budget_vs_actual'in canli govdeleri (pg_get_functiondef, birebir;
--   20261014001100 / 20261014011000 sonrasi). CREATE OR REPLACE ACL'i korur.
--   NOT: geri alma B103 (KDV'nin kar/zarardan ikinci kez dusulmesi) ve B104'u (vadeli kalem KDV'sinin beyana girmemesi) geri getirir.
--   Bu migration ile yazilan tahsilat hareketlerinin vat_amount'u kalir (eski govde bu alani okumaz; kar/zarar KDV haric kalir).
set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.finance_pnl(p_from date, p_to date)
 RETURNS TABLE(month date, income numeric, expense numeric, net numeric, income_by_category jsonb, expense_by_category jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    select pg_catalog.date_trunc('month', (c.created_at at time zone 'Europe/Istanbul'))::date as lm, 'in'::text as side,
           'komisyon'::text as cat,
           c.gross_amount - coalesce(c.vat_amount, 0)
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
$function$;

CREATE OR REPLACE FUNCTION public.finance_vat_summary(p_from date, p_to date)
 RETURNS TABLE(month date, output_vat numeric, input_vat numeric, payable numeric, withholding_paid numeric, withholding_collected numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  ent as (
    select pg_catalog.date_trunc('month', e.entry_date)::date as em, e.direction, e.source_type,
           coalesce(e.vat_amount, 0) as vat, coalesce(e.withholding_amount, 0) as wh
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
  )
  select mo.m,
         (coalesce((select sum(x.vat) from ent x where x.em = mo.m and x.direction = 'in' and x.source_type <> 'commission'), 0)
           + coalesce((select sum(c.vat) from com c where c.cm = mo.m), 0))::numeric,
         coalesce((select sum(x.vat) from ent x where x.em = mo.m and x.direction = 'out'), 0)::numeric,
         (coalesce((select sum(x.vat) from ent x where x.em = mo.m and x.direction = 'in' and x.source_type <> 'commission'), 0)
           + coalesce((select sum(c.vat) from com c where c.cm = mo.m), 0)
           - coalesce((select sum(x.vat) from ent x where x.em = mo.m and x.direction = 'out'), 0))::numeric,
         coalesce((select sum(x.wh) from ent x where x.em = mo.m and x.direction = 'out'), 0)::numeric,
         coalesce((select sum(x.wh) from ent x where x.em = mo.m and x.direction = 'in'), 0)::numeric
    from months mo
   order by mo.m;
end;
$function$;

CREATE OR REPLACE FUNCTION public.finance_open_item_settle(p_id uuid, p_account_id uuid, p_amount numeric DEFAULT NULL::numeric, p_date date DEFAULT NULL::date, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := public.finance_v2_ctx('create');
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_item public.finance_open_items%rowtype;
  v_wh_left numeric;
  v_cash_left numeric;
  v_amount numeric;
  v_id uuid;
begin
  if p_id is null or p_account_id is null then perform public.finance_v2_raise('invalid_input'); end if;
  select * into v_item from public.finance_open_items o where o.id = p_id and o.tenant_id = v_tenant for update;
  if not found then perform public.finance_v2_raise('not_found'); end if;
  if v_item.party_id is not null and not public.has_effective_permission('earnings_all', 'view')
     and public.finance_party_foreign_advisor(v_item.party_id) then
    perform public.finance_v2_raise('not_found');
  end if;
  if v_item.status not in ('open', 'partial') then perform public.finance_v2_raise('item_closed'); end if;
  if exists (select 1 from public.finance_accounts a where a.id = p_account_id and a.tenant_id = v_tenant)
     and not public.finance_account_is_office(p_account_id) then
    perform public.finance_v2_raise('invalid_input');
  end if;

  v_wh_left := case when coalesce(v_item.withholding_amount, 0) > 0 and not exists (
                      select 1 from public.cash_entries e
                       where e.open_item_id = p_id and e.voided_at is null and coalesce(e.withholding_amount, 0) > 0)
                    then v_item.withholding_amount else 0 end;
  v_cash_left := v_item.amount - v_item.paid_amount - v_wh_left;
  v_amount := coalesce(p_amount, v_cash_left);
  if v_amount < 0.01 or pg_catalog.round(v_amount, 2) <> v_amount or v_amount > v_cash_left + 0.005 then
    perform public.finance_v2_raise('amount_exceeds_open');
  end if;

  v_id := public.finance_record_entry_v2(jsonb_build_object(
    'account_id', p_account_id,
    'direction', case when v_item.direction = 'receivable' then 'in' else 'out' end,
    'amount', v_amount,
    'entry_date', coalesce(p_date, v_today),
    'category', coalesce(v_item.category, case when v_item.direction = 'receivable' then 'diger_gelir' else 'diger_gider' end),
    'title', v_item.title,
    'party_id', v_item.party_id,
    'property_id', v_item.property_id,
    'open_item_id', v_item.id,
    'note', p_note));

  if v_wh_left > 0 and v_amount >= v_cash_left - 0.005 then
    update public.cash_entries e set withholding_amount = v_wh_left where e.id = v_id;
  end if;
  return v_id;
end;
$function$;

revoke all on function public.finance_pnl(date, date) from public, anon;
grant execute on function public.finance_pnl(date, date) to authenticated, service_role;
revoke all on function public.finance_vat_summary(date, date) from public, anon;
grant execute on function public.finance_vat_summary(date, date) to authenticated, service_role;
revoke all on function public.finance_open_item_settle(uuid, uuid, numeric, date, text) from public, anon;
grant execute on function public.finance_open_item_settle(uuid, uuid, numeric, date, text) to authenticated, service_role;

-- SK6/B018 geri alma: finance_budget_vs_actual eski (tek parca) govdesine doner, service_role yardimcisi silinir.
CREATE OR REPLACE FUNCTION public.finance_budget_vs_actual(p_month date)
 RETURNS TABLE(direction text, category text, budget numeric, actual numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := public.finance_v2_ctx('view');
  v_gm boolean := public.finance_is_owner_gm();
  v_m date := pg_catalog.date_trunc('month', p_month)::date;
  v_m_end date;
begin
  if p_month is null then perform public.finance_v2_raise('invalid_input'); end if;
  v_m_end := (v_m + interval '1 month')::date;
  return query
  with b as (
    select distinct on (fb.direction, fb.category) fb.direction as bdir, fb.category as bcat, fb.amount as bamt
      from public.finance_budgets fb
     where fb.tenant_id = v_tenant and fb.period_month <= v_m and (fb.category is distinct from 'maas' or v_gm)
     order by fb.direction, fb.category, fb.period_month desc
  ),
  a as (
    select 'out'::text as adir, public.finance_v2_budget_category(x.category::text, 'out') as acat, x.amount as aamt
      from public.expenses x
     where x.tenant_id = v_tenant and x.is_sample = false and x.expense_date >= v_m and x.expense_date < v_m_end
       and not exists (select 1 from public.owner_charge_links l where l.kind = 'expense' and l.ref_id = x.id and l.tenant_id = x.tenant_id)
    union all
    select e.direction,
           public.finance_v2_budget_category(coalesce(e.category, case when e.direction = 'in' then 'diger_gelir' else 'diger_gider' end), e.direction),
           e.amount + coalesce(e.withholding_amount, 0) - coalesce(e.vat_amount, 0)
      from public.cash_entries e
      join public.finance_accounts ac on ac.id = e.account_id and ac.tenant_id = e.tenant_id and ac.owner_scope = 'office'
     where e.tenant_id = v_tenant and e.voided_at is null and e.is_sample = false and e.currency = 'TRY'
       and e.entry_date >= v_m and e.entry_date < v_m_end
       and ((e.kind = 'income') or (e.kind = 'expense' and e.expense_id is null))
       and coalesce(e.category, '') not in ('transfer', 'mulk_sahibi_odeme')
       and (e.category is distinct from 'maas' or v_gm)
  ),
  aa as (select a.adir, a.acat, sum(a.aamt) as aamt from a group by a.adir, a.acat)
  select coalesce(b.bdir, aa.adir), coalesce(b.bcat, aa.acat), coalesce(b.bamt, 0)::numeric, coalesce(aa.aamt, 0)::numeric
    from b
    full join aa on aa.adir = b.bdir and aa.acat = b.bcat
   where coalesce(b.bamt, 0) > 0 or coalesce(aa.aamt, 0) > 0
   order by 1, 2;
end;
$function$;

revoke all on function public.finance_budget_vs_actual(date) from public, anon;
grant execute on function public.finance_budget_vs_actual(date) to authenticated, service_role;
drop function if exists public.finance_budget_vs_actual_for(uuid, date, boolean);
