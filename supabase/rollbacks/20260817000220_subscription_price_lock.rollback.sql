-- Rollback: 20260817000220_subscription_price_lock
drop index if exists public.idx_subscriptions_price_lock_campaign;
alter table public.subscriptions drop column if exists price_lock_campaign;
alter table public.subscriptions drop column if exists price_lock_try;
