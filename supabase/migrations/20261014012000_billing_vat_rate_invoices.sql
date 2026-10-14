-- MIGRATION 20261014012000_billing_vat_rate_invoices.sql (GP2 — faturalama dogrulugu: otomatik faturada gecerlilik tarihli KDV)
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261014012000_billing_vat_rate_invoices.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261014012000_billing_vat_rate_invoices.rollback.sql
-- BAGIMLILIK: 20261014002000 (fulfill_billing_payment 10 arg canli govdesi; billing_plan_known donusumu), 20261007001010
--   (plan_upgrade dali), 20260826000600 (growth_cash_net). On-kosul eksikse HICBIR sey yazmadan durur.
--
-- NEDEN
--   Kod artik otomatik faturalari (abonelik, ek kullanici, analiz paketi, paket yukseltme, yonetici fark faturasi) ayar
--   defterindeki GECERLILIK TARIHLI KDV oraniyla keser (`billing.vat_rate`, getBillingVatRate) ve orani faturaya yazar
--   (`invoices.meta.vatRate`, 0..<1). fulfill_billing_payment ise tutari sabit %20 ile YENIDEN hesapliyordu
--   (`round(v_amount_try * 0.20, 2)`, 4 yer): oran degisince tahsil edilen fatura 22023 ile reddedilir (refund_required).
--
-- NE YAPAR
--   1) public.billing_invoice_vat_rate(meta jsonb): faturanin kesildigi andaki oran (meta.vatRate gecerli sayi ise o,
--      degilse 0.20). TS karsiligi `invoiceVatRateOf` (src/lib/billing/invoice-amounts.ts) AYNI kuraldir. Orani yazilmamis
--      (bu kuraldan once kesilmis) her fatura %20 kalir: mevcut davranis BIREBIR korunur.
--   2) fulfill_billing_payment (10 arg): CANLI govde uzerinden (pg_get_functiondef) YALNIZ `round(v_amount_try * 0.20, 2)`
--      ifadesi `round(v_amount_try * public.billing_invoice_vat_rate(v_invoice_meta), 2)` ile degistirilir (4 yer: analiz
--      paketi, paket yukseltme, ek kullanici, plan yenileme). Govdenin geri kalani, imza, SECURITY DEFINER, search_path ve
--      yetkiler aynen kalir. Beklenen eslesme sayisi tutmazsa HICBIR sey yazilmaz. Idempotent (donusturulmusse atlanir).
--   3) growth_cash_net: hesap kredisiyle odenen faturada nakit brut -> net donusumu `/ 1.2` yerine faturanin kendi orani.
--   4) public.billing_vat_rate_ready(): kod probu (service_role). Kod, oran %20'den FARKLIYKEN bu yoklama true olmadan
--      otomatik fatura acmaz (para tahsil edilmez; "altyapi guncellemesi bekleniyor").
--
-- BU DOSYA NE YAPMAZ: fatura/abonelik verisine, invoice_lines'a ve ayar defterine DOKUNMAZ. Eski faturalar kendi tutar/KDV'si ile kalir.
-- RISK: dusuk (oran %20 iken davranis ayni; yalniz farkli oranla kesilmis fatura artik dogrulanabilir).
-- SALT-OKUNUR DOGRULAMA (once/sonra):
--   select count(*) from regexp_matches(pg_get_functiondef('public.fulfill_billing_payment(text,text,text,text,text,uuid,text,text,numeric,text)'::regprocedure),
--     'round\(v_amount_try \* 0\.20, 2\)', 'g');                                   -- once 4, sonra 0
--   select public.billing_vat_rate_ready();                                         -- sonra true
--   select public.billing_invoice_vat_rate('{}'::jsonb), public.billing_invoice_vat_rate('{"vatRate":0.18}'::jsonb);  -- 0.20 / 0.18

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.invoices') is null then
    raise exception '20261014012000: public.invoices yok.';
  end if;
  if pg_catalog.to_regprocedure('public.fulfill_billing_payment(text,text,text,text,text,uuid,text,text,numeric,text)') is null then
    raise exception '20261014012000: fulfill_billing_payment (10 arg) yok; once 20261007001010 / 20261014002000 uygulanmali.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Faturanin KDV orani (meta.vatRate; yoksa/bozuksa %20)
-- ---------------------------------------------------------------------------
create or replace function public.billing_invoice_vat_rate(p_meta jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_meta -> 'vatRate') = 'number'
      and (p_meta ->> 'vatRate')::numeric >= 0
      and (p_meta ->> 'vatRate')::numeric < 1
      then (p_meta ->> 'vatRate')::numeric
    else 0.20
  end;
$$;

revoke all privileges on function public.billing_invoice_vat_rate(jsonb) from public, anon, authenticated;
grant execute on function public.billing_invoice_vat_rate(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 2. fulfill_billing_payment: sabit %20 -> faturanin orani (canli govde uzerinden, yalniz o ifade)
-- ---------------------------------------------------------------------------
do $$
declare
  v_sig constant text := 'public.fulfill_billing_payment(text,text,text,text,text,uuid,text,text,numeric,text)';
  v_pattern constant text := 'round\(v_amount_try \* 0\.20, 2\)';
  v_def text;
  v_count integer;
begin
  v_def := pg_catalog.pg_get_functiondef(v_sig::regprocedure);
  select count(*) into v_count from pg_catalog.regexp_matches(v_def, v_pattern, 'g');
  if v_count = 0 and pg_catalog.strpos(v_def, 'public.billing_invoice_vat_rate(v_invoice_meta)') > 0 then
    return; -- ikinci calistirma: zaten donusturulmus
  end if;
  if v_count <> 4 then
    raise exception '20261014012000: fulfill_billing_payment govdesinde 4 sabit KDV ifadesi bekleniyordu, % bulundu; govde beklenenden farkli, hicbir sey yazilmadi.', v_count;
  end if;
  if pg_catalog.strpos(v_def, 'v_invoice_meta jsonb') = 0 then
    raise exception '20261014012000: fulfill_billing_payment govdesinde v_invoice_meta yok; govde beklenenden farkli.';
  end if;
  execute pg_catalog.regexp_replace(v_def, v_pattern, 'round(v_amount_try * public.billing_invoice_vat_rate(v_invoice_meta), 2)', 'g');
end
$$;

-- ---------------------------------------------------------------------------
-- 3. growth_cash_net: nakit brut -> net, faturanin orani ile (20260826000600 govdesi; yalniz bolen degisir)
-- ---------------------------------------------------------------------------
do $$
begin
  if pg_catalog.to_regprocedure('public.growth_cash_net(uuid)') is null then
    return; -- referans motoru kurulu degil: atlanir
  end if;
  execute $f$
create or replace function public.growth_cash_net(p_invoice uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $body$
  select round(case
           when jsonb_typeof(i.meta -> 'walletCashTry') = 'number' and (i.meta ->> 'walletCashTry')::numeric > 0
             then least((i.meta ->> 'walletCashTry')::numeric / (1 + public.billing_invoice_vat_rate(i.meta)), i.amount_try)
           else i.amount_try end, 2)
  from public.invoices i where i.id = p_invoice;
$body$
$f$;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Kod probu: fulfill faturanin oranini okuyor mu?
-- ---------------------------------------------------------------------------
create or replace function public.billing_vat_rate_ready()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_src text;
begin
  select p.prosrc into v_src
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.fulfill_billing_payment(text,text,text,text,text,uuid,text,text,numeric,text)');
  return v_src is not null
    and pg_catalog.strpos(v_src, 'public.billing_invoice_vat_rate(v_invoice_meta)') > 0
    and pg_catalog.strpos(v_src, 'v_amount_try * 0.20') = 0;
exception when others then
  return false;
end;
$$;

revoke all privileges on function public.billing_vat_rate_ready() from public, anon, authenticated;
grant execute on function public.billing_vat_rate_ready() to service_role;
