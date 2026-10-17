-- GERI ALMA: 20261023040001_expense_claims — karar tetigi, RPC ve tablo duser. Onaylanmis taleplerin yazdigi acik kalemler
-- (finance_open_items, source_type 'expense_claim') DEFTERDE KALIR (muhasebe kaydi geri alinmaz; gerekirse kalem iptali).
-- expense-claims kovasindaki fis dosyalari silinmez (kova elle bosaltilir).

set local lock_timeout = '5s';

drop trigger if exists trg_approval_requests_expense_claim on public.approval_requests;
drop function if exists public.expense_claim_on_decision();
drop function if exists public.expense_claim_submit(jsonb);
drop table if exists public.expense_claims;
