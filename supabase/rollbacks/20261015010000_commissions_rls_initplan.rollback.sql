-- 20261015010000 geri alma: commissions_select eski ifadesi (20260813000100 sarmasi; satir basina
--   can_view_commission_earnings). Gölge zincirinden pg_get_expr ile search_path='' altinda birebir deparse edildi.
-- ALTER POLICY: ad/komut/rol degismez. Veri degismez.
set local lock_timeout = '5s';
alter policy commissions_select on public.commissions
  using (((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND ( SELECT public.can_view_commission_earnings(commissions.tenant_id, commissions.deal_id, commissions.id) AS can_view_commission_earnings)));
comment on policy commissions_select on public.commissions is null;
