-- MIGRATION 20261017010400_finance_pnl_v3.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- Tasarim: docs/design/FINANS_ENTEGRASYON_2026-10.md, "Hedef mimari" (degistirilmis tahakkuk) + WP2 `finance_pnl_v3`.
-- Geri alma: supabase/rollbacks/20261017010400_finance_pnl_v3.rollback.sql (uc parametreli surumler duser; iki parametreli
--   finance_pnl / finance_vat_summary 20261016060100 govdeleriyle birebir geri gelir, ACL ayni).
-- BAGIMLILIK: 20261017010200 (tahakkuk kalemleri + offbook_amount), 20261017010000 (reversal_of / event_type / invoice_id),
--   20261016060100 (son finance_pnl / finance_vat_summary govdeleri), 20261010000700 (einvoices).
--
-- IMZA: finance_pnl(p_from, p_to, p_basis text default 'tahakkuk') ve finance_vat_summary(p_from, p_to, p_basis default
--   'tahakkuk'). Iki parametreli eski surumler DUSER (ayni adla iki surum belirsiz cagri olurdu); mevcut cagiranlar
--   ({p_from, p_to}) varsayilan 'tahakkuk' ile ayni kolonlari alir. Gecersiz esas -> invalid_input.
--
-- K/Z ('tahakkuk', varsayilan):
--   + Acik kalemler DUZENLEME ayinda, KDV haric (amount - vat_amount): alacak -> gelir, borc -> gider (kalem kategorisi).
--     Ayna kalem (reversal_of) ASLI yonunde eksi sayilir (kilitli ay ters kaydi ilk acik ayda geliri/gideri dusurur).
--     Kapsam disi (emanet / gecis) kategoriler: depozito, kira_tahsilat, aidat_tahsilat, mulk_sahibi_odeme, transfer, stopaj.
--     Mulk sahibine yansitilan aidat (owner_charge_links kind 'due') gider sayilmaz (dues.accrued 'conditional').
--   + Komisyon: kalemden brut gelir ('komisyon') + ofis disi paylar ayri gider satiri ('danisman_hakedis').
--     SUNUM FARKI: eskiden tek satir 'komisyon' = brut - ofis disi paylar; NET AYNI (gelir ve gider pay kadar buyur).
--     Tahakkuk kalemi olmayan (geri doldurulmamis) komisyon ayni iki satirla commissions tablosundan sayilir.
--   + Yonetim ucreti (rent_payments.management_fee, tahsilat gunu) ve eski `expenses` satirlari 20261016060100 ile ayni.
--   + Nakit: acik kaleme BAGLI OLMAYAN ofis hareketleri 20261016060100 kapsamiyla (elle gelir; gidere donusmemis cikis),
--     ek olarak kapsam disi kategoriler (depozito vb.) dislanir ve ayna hareket (kind 'adjust', reversal_of) aslinin
--     turu/yonuyle eksi sayilir. Kaleme bagli tahsilat/odeme hareketi kalemle zaten sayildigindan tekrar sayilmaz.
--     SUNUM FARKI: elle acik kalem (vadeli alacak/borc) tahsilat ayi yerine duzenleme ayinda; depozito artik gelir degil;
--     payi olmayan onayli hakedis (payout.approved) gider; kilitli ay ters kaydi ilk acik ayda duser.
-- K/Z ('nakit'): yalniz ofis hesabi hareketleri hareket gununde (komisyon tahsilati dahil, KDV'si orantili dusulur),
--   yonetim ucreti ve eski `expenses`. Acik kalem okunmaz. Kasa disi kapanan tutarlar (offbook) nakit esasinda YOKTUR.
-- KDV ('tahakkuk'): acik kalemin KDV'si fatura ayinda: bagli e-fatura (invoice_id; yoksa komisyon kaynakli kesilmis
--   e-fatura) varsa onun issue_date'i, yoksa kalemin duzenleme gunu (KDVK md.10). Ayna kalem kendi ayinda eksi.
--   Kaleme bagli hareketin KDV'si ikinci kez sayilmaz. Kalemsiz komisyonun KDV'si fatura (yoksa olusturma) ayinda.
-- KDV ('nakit'): hareketlerin KDV'si hareket gununde (eski komisyon tahsilatinda orantili). Stopaj her iki esasta hareketten.
-- GUVENLIK: SECURITY DEFINER + search_path=''; kiraci + expenses:view = finance_v2_ctx('view'); maas satirlari yalniz owner/gm.
-- ETKI: davranis (K/Z sunumu ve ay dagilimi degisir; komisyon neti ayni). Bkz. src/lib/finance/pnl-v3-sql-exec.test.ts.
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('public.finance_pnl(date,date)') is null
     and pg_catalog.to_regprocedure('public.finance_pnl(date,date,text)') is null then
    raise exception '20261017010400: finance_pnl yok (20261014001100 / 20261016060100 once uygulanmali).';
  end if;
  if pg_catalog.to_regprocedure('public.finance_v2_ctx(text)') is null
     or pg_catalog.to_regprocedure('public.finance_is_owner_gm()') is null
     or pg_catalog.to_regclass('public.owner_charge_links') is null
     or pg_catalog.to_regclass('public.rent_payments') is null
     or pg_catalog.to_regclass('public.einvoices') is null
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.finance_open_items'::regclass and attname = 'reversal_of' and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.finance_open_items'::regclass and attname = 'offbook_amount' and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.cash_entries'::regclass and attname = 'reversal_of' and not attisdropped) then
    raise exception '20261017010400: once 20261017010000 ve 20261017010200 uygulanmali.';
  end if;
end $$;

drop function if exists public.finance_pnl(date, date);
drop function if exists public.finance_vat_summary(date, date);

create or replace function public.finance_pnl(p_from date, p_to date, p_basis text default 'tahakkuk')
returns table(month date, income numeric, expense numeric, net numeric, income_by_category jsonb, expense_by_category jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('view');
  v_gm boolean := public.finance_is_owner_gm();
  v_accrual boolean;
  v_m1 date;
  v_m2 date;
  v_end date;
  -- Emanet / gecis kategorileri: K/Z'ye girmez (iki esasta da).
  v_pass text[] := array['transfer', 'depozito', 'kira_tahsilat', 'aidat_tahsilat', 'mulk_sahibi_odeme', 'stopaj'];
begin
  if p_from is null or p_to is null or p_from > p_to or coalesce(p_basis, '') not in ('tahakkuk', 'nakit') then
    perform public.finance_v2_raise('invalid_input');
  end if;
  v_accrual := p_basis = 'tahakkuk';
  v_m1 := pg_catalog.date_trunc('month', p_from)::date;
  v_m2 := pg_catalog.date_trunc('month', p_to)::date;
  if v_m2 > (v_m1 + interval '36 months')::date then perform public.finance_v2_raise('invalid_input'); end if;
  v_end := (v_m2 + interval '1 month')::date;

  return query
  with months as (
    select g.m::date as m from pg_catalog.generate_series(v_m1::timestamp, v_m2::timestamp, interval '1 month') g(m)
  ),
  lines as (
    -- (tahakkuk) acik kalemler: duzenleme ayi, KDV haric; ayna asli yonunde eksi.
    select pg_catalog.date_trunc('month', o.issue_date)::date as lm,
           case when coalesce(src.direction, o.direction) = 'receivable' then 'in' else 'out' end::text as side,
           coalesce(o.category, case when coalesce(src.direction, o.direction) = 'receivable' then 'diger_gelir' else 'diger_gider' end)::text as cat,
           (case when o.reversal_of is null then 1 else -1 end) * (o.amount - coalesce(o.vat_amount, 0)) as amt
      from public.finance_open_items o
      left join public.finance_open_items src on src.id = o.reversal_of and src.tenant_id = o.tenant_id
     where v_accrual and o.tenant_id = v_tenant and o.status <> 'cancelled' and o.is_sample = false and o.currency = 'TRY'
       and o.issue_date >= v_m1 and o.issue_date < v_end
       and coalesce(o.category, '') <> all (v_pass)
       and (o.category is distinct from 'maas' or v_gm)
       and not (o.source_type = 'due' and exists (
             select 1 from public.owner_charge_links l where l.kind = 'due' and l.ref_id = o.source_id and l.tenant_id = o.tenant_id))
    union all
    -- (tahakkuk) tahakkuk kalemi olmayan komisyon: brut gelir + ofis disi paylar gider (eski satirla ayni net).
    select pg_catalog.date_trunc('month', (c.created_at at time zone 'Europe/Istanbul'))::date, 'in', 'komisyon', c.gross_amount
      from public.commissions c
     where v_accrual and c.tenant_id = v_tenant and c.status <> 'cancelled' and c.is_sample = false
       and (c.created_at at time zone 'Europe/Istanbul')::date >= v_m1
       and (c.created_at at time zone 'Europe/Istanbul')::date < v_end
       and not exists (select 1 from public.finance_open_items x
                        where x.tenant_id = c.tenant_id and x.event_type = 'commission.accrued' and x.source_id = c.id)
    union all
    select pg_catalog.date_trunc('month', (c.created_at at time zone 'Europe/Istanbul'))::date, 'out', 'danisman_hakedis', sp.amt
      from public.commissions c
      cross join lateral (
        select sum(s.amount) as amt from public.commission_splits s
         where s.commission_id = c.id and s.tenant_id = c.tenant_id and s.kind <> 'office') sp
     where v_accrual and c.tenant_id = v_tenant and c.status <> 'cancelled' and c.is_sample = false
       and coalesce(sp.amt, 0) <> 0
       and (c.created_at at time zone 'Europe/Istanbul')::date >= v_m1
       and (c.created_at at time zone 'Europe/Istanbul')::date < v_end
       and not exists (select 1 from public.finance_open_items x
                        where x.tenant_id = c.tenant_id and x.event_type = 'commission.accrued' and x.source_id = c.id)
    union all
    -- Yonetim ucreti (iki esas): tahsilat gunu.
    select pg_catalog.date_trunc('month', rp.paid_on)::date, 'in', 'kira_yonetimi', rp.management_fee
      from public.rent_payments rp
     where rp.tenant_id = v_tenant and rp.voided_at is null and rp.management_fee > 0
       and rp.paid_on >= v_m1 and rp.paid_on < v_end
    union all
    -- Ofis hesabi hareketleri. Ayna (reversal_of) aslinin turu/yonu/kaynagiyla eksi.
    select pg_catalog.date_trunc('month', e.entry_date)::date,
           coalesce(src.direction, e.direction),
           coalesce(e.category, case when coalesce(src.direction, e.direction) = 'in' then 'diger_gelir' else 'diger_gider' end),
           (case when e.reversal_of is null then 1 else -1 end)
             * (e.amount + coalesce(e.withholding_amount, 0)
                - coalesce(e.vat_amount,
                           case when not v_accrual and coalesce(src.source_type, e.source_type) = 'commission' then
                             (select pg_catalog.round(e.amount * c.vat_amount / nullif(c.gross_amount + c.vat_amount, 0), 2)
                                from public.commissions c
                               where c.id = e.source_id and c.tenant_id = e.tenant_id and c.vat_amount > 0)
                           end, 0))
      from public.cash_entries e
      join public.finance_accounts a on a.id = e.account_id and a.tenant_id = e.tenant_id and a.owner_scope = 'office'
      left join public.cash_entries src on src.id = e.reversal_of and src.tenant_id = e.tenant_id
     where e.tenant_id = v_tenant and e.voided_at is null and e.is_sample = false and e.currency = 'TRY'
       and e.entry_date >= v_m1 and e.entry_date < v_end
       and (not v_accrual or e.open_item_id is null)
       and coalesce(e.category, '') <> all (v_pass)
       and coalesce(e.category, '') <> 'kira_yonetimi'
       and (e.reversal_of is null or src.id is not null)
       and (
         (coalesce(src.kind, e.kind) = 'income'
           and (not v_accrual
                or (coalesce(src.source_type, e.source_type) = 'manual' and coalesce(e.category, '') <> 'komisyon')))
         or (coalesce(src.kind, e.kind) = 'expense' and coalesce(src.expense_id, e.expense_id) is null
           and coalesce(src.source_type, e.source_type) <> 'owner_payout')
       )
       and (e.category is distinct from 'maas' or v_gm)
    union all
    -- Eski gider tablosu (iki esas; WP5 dondurur): 20261016060100 ile ayni.
    select pg_catalog.date_trunc('month', x.expense_date)::date, 'out', x.category::text, x.amount
      from public.expenses x
     where x.tenant_id = v_tenant and x.is_sample = false
       and x.expense_date >= v_m1 and x.expense_date < v_end
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

create or replace function public.finance_vat_summary(p_from date, p_to date, p_basis text default 'tahakkuk')
returns table(month date, output_vat numeric, input_vat numeric, payable numeric, withholding_paid numeric, withholding_collected numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('view');
  v_gm boolean := public.finance_is_owner_gm();
  v_accrual boolean;
  v_m1 date;
  v_m2 date;
begin
  if p_from is null or p_to is null or p_from > p_to or coalesce(p_basis, '') not in ('tahakkuk', 'nakit') then
    perform public.finance_v2_raise('invalid_input');
  end if;
  v_accrual := p_basis = 'tahakkuk';
  v_m1 := pg_catalog.date_trunc('month', p_from)::date;
  v_m2 := pg_catalog.date_trunc('month', p_to)::date;
  if v_m2 > (v_m1 + interval '36 months')::date then perform public.finance_v2_raise('invalid_input'); end if;

  return query
  with months as (
    select g.m::date as m from pg_catalog.generate_series(v_m1::timestamp, v_m2::timestamp, interval '1 month') g(m)
  ),
  -- (tahakkuk) KDV'si fatura ayinda sayilan acik kalemler; ayna kendi ayinda, asli yonunde eksi.
  oi as (
    select o.id,
           pg_catalog.date_trunc('month', case when o.reversal_of is null then coalesce(inv.issue_date, o.issue_date) else o.issue_date end)::date as om,
           coalesce(src.direction, o.direction) as direction,
           (case when o.reversal_of is null then 1 else -1 end) * o.vat_amount as vat
      from public.finance_open_items o
      left join public.finance_open_items src on src.id = o.reversal_of and src.tenant_id = o.tenant_id
      left join lateral (
        select x.issue_date from public.einvoices x
         where x.tenant_id = o.tenant_id and x.status = 'issued'
           and (x.id = o.invoice_id
                or (o.invoice_id is null and o.source_type = 'commission' and x.source_type = 'commission' and x.source_id = o.source_id))
         order by (x.id = o.invoice_id) desc, x.issue_date, x.id
         limit 1
      ) inv on true
     where v_accrual and o.tenant_id = v_tenant and o.cancelled_at is null and o.is_sample = false and o.currency = 'TRY'
       and coalesce(o.vat_amount, 0) > 0
       and (o.category is distinct from 'maas' or v_gm)
  ),
  ent as (
    select pg_catalog.date_trunc('month', e.entry_date)::date as em,
           coalesce(src.direction, e.direction) as direction,
           coalesce(src.source_type, e.source_type) as source_type,
           (case when e.reversal_of is null then 1 else -1 end)
             * case when v_accrual and e.open_item_id is not null and exists (select 1 from oi where oi.id = e.open_item_id) then 0
                    else coalesce(e.vat_amount,
                                  case when not v_accrual and coalesce(src.source_type, e.source_type) = 'commission' then
                                    (select pg_catalog.round(e.amount * c.vat_amount / nullif(c.gross_amount + c.vat_amount, 0), 2)
                                       from public.commissions c
                                      where c.id = e.source_id and c.tenant_id = e.tenant_id and c.vat_amount > 0)
                                  end, 0) end as vat,
           (case when e.reversal_of is null then 1 else -1 end) * coalesce(e.withholding_amount, 0) as wh
      from public.cash_entries e
      join public.finance_accounts a on a.id = e.account_id and a.tenant_id = e.tenant_id and a.owner_scope = 'office'
      left join public.cash_entries src on src.id = e.reversal_of and src.tenant_id = e.tenant_id
     where e.tenant_id = v_tenant and e.voided_at is null and e.currency = 'TRY'
       and (e.kind in ('income', 'expense') or (e.reversal_of is not null and src.kind in ('income', 'expense')))
       and e.entry_date >= v_m1 and e.entry_date < (v_m2 + interval '1 month')::date
       and (e.category is distinct from 'maas' or v_gm)
  ),
  -- (tahakkuk) tahakkuk kalemi olmayan komisyonun KDV'si: kesilmis e-fatura ayinda, yoksa olusturma ayinda.
  com as (
    select pg_catalog.date_trunc('month', coalesce(inv.issue_date, (c.created_at at time zone 'Europe/Istanbul')::date))::date as cm,
           coalesce(c.vat_amount, 0) as vat
      from public.commissions c
      left join lateral (
        select x.issue_date from public.einvoices x
         where x.tenant_id = c.tenant_id and x.status = 'issued' and x.source_type = 'commission' and x.source_id = c.id
         order by x.issue_date, x.id limit 1
      ) inv on true
     where v_accrual and c.tenant_id = v_tenant and c.status <> 'cancelled' and c.is_sample = false
       and not exists (select 1 from public.finance_open_items x
                        where x.tenant_id = c.tenant_id and x.event_type = 'commission.accrued' and x.source_id = c.id)
  ),
  agg as (
    select mo.m,
           coalesce((select sum(x.vat) from ent x
                      where x.em = mo.m and x.direction = 'in' and (not v_accrual or x.source_type <> 'commission')), 0)
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

revoke all on function public.finance_pnl(date, date, text) from public, anon;
grant execute on function public.finance_pnl(date, date, text) to authenticated, service_role;
revoke all on function public.finance_vat_summary(date, date, text) from public, anon;
grant execute on function public.finance_vat_summary(date, date, text) to authenticated, service_role;

comment on function public.finance_pnl(date, date, text) is
  'K/Z v3: p_basis tahakkuk (varsayilan; acik kalem duzenleme ayinda + kalemsiz nakit, komisyon brut + danisman pay gider satiri) | nakit (ofis hareketleri). Emanet kategorileri ve ayna kayitlar dogru isaretle.';
comment on function public.finance_vat_summary(date, date, text) is
  'KDV v3: p_basis tahakkuk (kalem KDV fatura/e-fatura ayinda; ayna eksi) | nakit (hareket gununde).';
