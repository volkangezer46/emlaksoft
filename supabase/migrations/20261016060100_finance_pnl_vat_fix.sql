-- MIGRATION 20261016060100_finance_pnl_vat_fix.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI uygular.
-- Geri alma: supabase/rollbacks/20261016060100_finance_pnl_vat_fix.rollback.sql (dort fonksiyonun canli govdesi birebir;
--   finance_budget_vs_actual_for silinir).
-- BAGIMLILIK: 20261014001100_finance_ledger_v2_rpc.sql (finance_pnl, finance_vat_summary ilk tanim + ACL),
--   20261014011000_finance_party_advisor_scope.sql (finance_open_item_settle son govdesi; P12 cari kapsami).
--
-- BULGU SK6/B103 (kar/zarar KDV'yi iki kez dusuyor): commissions.gross_amount KDV HARIC matrahtir (kapanis RPC'si v_net'i yazar,
--   20260813000000:992-997, :1893; DB'de vat/gross orani her ay tam %20). finance_pnl komisyon satiri yine de
--   'gross_amount - vat_amount - dis paylar' yaziyordu: KDV ikinci kez dusuluyordu (2026 neti ~626 bin TL eksik).
--   COZUM: komisyon satiri = gross_amount - ofis disi paylar. KDV yalniz bilgi (Vergi sekmesi commissions.vat_amount'u zaten sayar).
-- BULGU SK6/B104 (vadeli KDV'li faturanin KDV'si beyana girmiyor): finance_vat_summary yalniz cash_entries ve commissions KDV'sini
--   topluyordu; finance_open_items.vat_amount hic okunmuyordu. finance_open_item_settle tahsilat hareketini KDV'siz yaziyordu, bu yuzden
--   KDV ne duzenleme ne tahsilat ayinda beyana giriyordu ve tahsilat kar/zarara KDV DAHIL gelir olarak giriyordu.
--   COZUM: (a) finance_vat_summary acik kalemin KDV'sini DUZENLEME (issue_date) ayinda sayar (KDVK md.10: vergiyi doguran olay fatura
--   duzenlenmesi): receivable -> hesaplanan, payable -> indirilecek. Iptal edilen ve ornek kalem sayilmaz. Bu kaleme bagli hareketlerin
--   KDV'si ikinci kez sayilmaz. (b) finance_open_item_settle tahsilat/odeme hareketine ORANTILI KDV yazar (kalem KDV'si x belge payi /
--   kalem tutari; son tahsilat kalan KDV'yi alir, yuvarlama artigi kalmaz). Boylece finance_pnl geliri KDV haric sayar ve Hareketler'de
--   KDV gorunur. Nakit tutar, stopaj ve kalem kapanisi DEGISMEZ.
-- BULGU SK6/B018 (butce icgorusu ile Butce sekmesi farkli kaynak): govde finance_budget_vs_actual_for(p_tenant, p_month, p_include_salary)
--   fonksiyonuna tasinir (YALNIZ service_role); finance_budget_vs_actual onu oturum kapisindan (finance_v2_ctx) cagirir. Ayrinti dosya sonunda.
-- IMZA/ACL: mevcut dort fonksiyonun imzasi ayni; CREATE OR REPLACE ACL'i korur (yine de yeniden yazilir). Yeni fonksiyon yalniz service_role.
-- KOD SIRASI: bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir (kod RPC ciktisini ayni anahtarlarla okur; yalniz degerler duzelir).
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.finance_open_items') is null
     or pg_catalog.to_regprocedure('public.finance_v2_ctx(text)') is null
     or pg_catalog.to_regprocedure('public.finance_record_entry_v2(jsonb)') is null
     or pg_catalog.to_regprocedure('public.finance_party_foreign_advisor(uuid)') is null then
    raise exception '20261016060100: finans v2 (20261014001100 / 20261014011000) yok.';
  end if;
end $$;

-- B103: komisyon satiri = matrah (gross_amount, KDV haric) - ofis disi paylar. Diger satirlar 20261014001100 ile ayni.
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

-- B104 (a): acik kalemin KDV'si duzenleme ayinda; bagli hareketin KDV'si ikinci kez sayilmaz.
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

-- B104 (b): tahsilat/odeme hareketine orantili KDV. Nakit tutar ve stopaj 20261014011000 ile ayni.
create or replace function public.finance_open_item_settle(p_id uuid, p_account_id uuid, p_amount numeric default null,
  p_date date default null, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('create');
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_item public.finance_open_items%rowtype;
  v_wh_left numeric;
  v_cash_left numeric;
  v_amount numeric;
  v_final boolean;
  v_doc numeric;
  v_vat numeric;
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
  v_final := v_amount >= v_cash_left - 0.005;

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

  if v_wh_left > 0 and v_final then
    update public.cash_entries e set withholding_amount = v_wh_left where e.id = v_id;
  end if;

  -- Orantili KDV: belge payi = nakit + (son odemede) stopaj; KDV = kalem KDV'si x belge payi / kalem tutari.
  -- Son tahsilat kalan KDV'yi alir (kismi tahsilatlarin yuvarlama artigi kalmaz). KDV beyanda kalemin duzenleme ayinda
  -- sayilir (finance_vat_summary); hareketteki KDV kar/zarari KDV haric yapar ve Hareketler'de gorunur.
  if coalesce(v_item.vat_amount, 0) > 0 and v_item.amount > 0 then
    v_doc := v_amount + case when v_final then v_wh_left else 0 end;
    if v_final then
      v_vat := v_item.vat_amount - coalesce((
        select sum(coalesce(e.vat_amount, 0)) from public.cash_entries e
         where e.open_item_id = p_id and e.tenant_id = v_tenant and e.voided_at is null and e.id <> v_id), 0);
    else
      v_vat := pg_catalog.round(v_item.vat_amount * v_doc / v_item.amount, 2);
    end if;
    v_vat := greatest(0, least(v_vat, v_item.vat_amount));
    update public.cash_entries e
       set vat_rate = v_item.vat_rate, vat_amount = v_vat, vat_included = true
     where e.id = v_id and e.tenant_id = v_tenant;
  end if;
  return v_id;
end;
$$;

revoke all on function public.finance_pnl(date, date) from public, anon;
grant execute on function public.finance_pnl(date, date) to authenticated, service_role;
revoke all on function public.finance_vat_summary(date, date) from public, anon;
grant execute on function public.finance_vat_summary(date, date) to authenticated, service_role;
revoke all on function public.finance_open_item_settle(uuid, uuid, numeric, date, text) from public, anon;
grant execute on function public.finance_open_item_settle(uuid, uuid, numeric, date, text) to authenticated, service_role;

-- ===========================================================================
-- SK6/B018: Butce <-> gerceklesen TEK KAYNAK. Icgoru motoru (expense_budget@1) eskiden v1 'expense_budgets' tablosunu ve yalniz
--   'expenses' toplamini okuyordu; Butce sekmesi ise finance_budgets (v2) + hareketleri (finance_budget_vs_actual). Kart 45.000 TL
--   derken sekme 70.710 TL gosteriyordu. Govde finance_budget_vs_actual_for'a tasinir; sekme (oturum, finance_v2_ctx) ve motor
--   (service_role, acik kiraci) AYNI govdeyi okur. finance_budget_vs_actual'in imzasi, guvenligi ve ciktisi AYNI.
--   Tek fark: komisyon tahsilati hareketi (source_type 'commission', SK6/B109 ile KDV DAHIL yazilir; v1 hareketinde vat_amount bos)
--   gerceklesene KDV HARIC girer (komisyonun KDV payi orantili dusulur); boylece gelir hedefi kar/zarar ile ayni tabanda kalir.
-- ===========================================================================
create or replace function public.finance_budget_vs_actual_for(p_tenant uuid, p_month date, p_include_salary boolean)
returns table (direction text, category text, budget numeric, actual numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_m date := pg_catalog.date_trunc('month', p_month)::date;
  v_m_end date;
  v_gm boolean := coalesce(p_include_salary, false);
begin
  if p_tenant is null or p_month is null then perform public.finance_v2_raise('invalid_input'); end if;
  v_m_end := (v_m + interval '1 month')::date;
  return query
  with b as (
    select distinct on (fb.direction, fb.category) fb.direction as bdir, fb.category as bcat, fb.amount as bamt
      from public.finance_budgets fb
     where fb.tenant_id = p_tenant and fb.period_month <= v_m and (fb.category is distinct from 'maas' or v_gm)
     order by fb.direction, fb.category, fb.period_month desc
  ),
  a as (
    select 'out'::text as adir, public.finance_v2_budget_category(x.category::text, 'out') as acat, x.amount as aamt
      from public.expenses x
     where x.tenant_id = p_tenant and x.is_sample = false and x.expense_date >= v_m and x.expense_date < v_m_end
       and not exists (select 1 from public.owner_charge_links l where l.kind = 'expense' and l.ref_id = x.id and l.tenant_id = x.tenant_id)
    union all
    select e.direction,
           public.finance_v2_budget_category(coalesce(e.category, case when e.direction = 'in' then 'diger_gelir' else 'diger_gider' end), e.direction),
           e.amount + coalesce(e.withholding_amount, 0)
             - coalesce(e.vat_amount,
                        case when e.source_type = 'commission' then
                          (select pg_catalog.round(e.amount * c.vat_amount / nullif(c.gross_amount + c.vat_amount, 0), 2)
                             from public.commissions c
                            where c.id = e.source_id and c.tenant_id = e.tenant_id and c.vat_amount > 0)
                        end, 0)
      from public.cash_entries e
      join public.finance_accounts ac on ac.id = e.account_id and ac.tenant_id = e.tenant_id and ac.owner_scope = 'office'
     where e.tenant_id = p_tenant and e.voided_at is null and e.is_sample = false and e.currency = 'TRY'
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
$$;

-- Acik kiraci parametresi: YALNIZ service_role (icgoru motoru). Oturum yolu asagidaki sarmalayicidan gecer (finance_v2_ctx kapisi).
revoke all on function public.finance_budget_vs_actual_for(uuid, date, boolean) from public, anon, authenticated;
grant execute on function public.finance_budget_vs_actual_for(uuid, date, boolean) to service_role;

create or replace function public.finance_budget_vs_actual(p_month date)
returns table (direction text, category text, budget numeric, actual numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('view');
begin
  if p_month is null then perform public.finance_v2_raise('invalid_input'); end if;
  return query select * from public.finance_budget_vs_actual_for(v_tenant, p_month, public.finance_is_owner_gm());
end;
$$;

revoke all on function public.finance_budget_vs_actual(date) from public, anon;
grant execute on function public.finance_budget_vs_actual(date) to authenticated, service_role;
