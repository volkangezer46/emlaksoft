-- Rollback: 20260819010500_k5_account_subscription_branches
-- UYARI: iptal talepleri ve sube telefonlari kalici olarak silinir.
alter table public.subscriptions
  drop column if exists cancel_at_period_end,
  drop column if exists cancel_requested_at,
  drop column if exists cancel_reason;

alter table public.branches
  drop column if exists phone;

notify pgrst, 'reload schema';
