-- Geri alma: 20261014012000_billing_vat_rate_invoices.sql
-- fulfill_billing_payment sabit %20'ye (`round(v_amount_try * 0.20, 2)`) ve growth_cash_net `/ 1.2`'ye doner; yoklama ve
-- oran yardimcisi silinir. Yoklama kalkinca kod, oran %20'den farkliyken otomatik fatura ACMAZ (para alinmaz).
-- UYARI: geri almadan once %20 disi oranla kesilmis ve henuz tamamlanmamis (draft + initialized) otomatik fatura varsa
--   o faturanin odemesi geri almadan sonra 22023 ile reddedilir (refund_required). Once kontrol edin:
--   select id, invoice_no, meta->>'vatRate' from public.invoices
--   where status = 'draft' and checkout_status in ('pending_checkout','initialized') and coalesce((meta->>'vatRate')::numeric, 0.20) <> 0.20;

set local lock_timeout = '5s';

drop function if exists public.billing_vat_rate_ready();

do $$
declare
  v_sig constant text := 'public.fulfill_billing_payment(text,text,text,text,text,uuid,text,text,numeric,text)';
  v_pattern constant text := 'round\(v_amount_try \* public\.billing_invoice_vat_rate\(v_invoice_meta\), 2\)';
  v_def text;
begin
  if pg_catalog.to_regprocedure(v_sig) is null then
    return;
  end if;
  v_def := pg_catalog.pg_get_functiondef(v_sig::regprocedure);
  if pg_catalog.strpos(v_def, 'public.billing_invoice_vat_rate(') = 0 then
    return;
  end if;
  execute pg_catalog.regexp_replace(v_def, v_pattern, 'round(v_amount_try * 0.20, 2)', 'g');
end
$$;

do $$
begin
  if pg_catalog.to_regprocedure('public.growth_cash_net(uuid)') is null then
    return;
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
             then least((i.meta ->> 'walletCashTry')::numeric / 1.2, i.amount_try)
           else i.amount_try end, 2)
  from public.invoices i where i.id = p_invoice;
$body$
$f$;
end
$$;

drop function if exists public.billing_invoice_vat_rate(jsonb);
