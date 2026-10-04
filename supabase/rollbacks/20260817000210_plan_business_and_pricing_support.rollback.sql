-- Rollback: 20260817000210_plan_business_and_pricing_support
-- Business kullanan tenant/abonelik varsa önce başka pakete taşınmalıdır; aksi halde kısıt eklenemez.
drop function if exists public.plan_entitlements_writable();
revoke insert, update on public.plan_entitlements from service_role;
delete from public.plan_entitlements where plan = 'business';
alter table public.tenants drop constraint if exists tenants_plan_check;
alter table public.subscriptions drop constraint if exists subscriptions_plan_check;
alter table public.plan_entitlements drop constraint if exists plan_entitlements_plan_check;
alter table public.tenants add constraint tenants_plan_check check (plan in ('advisor','office','professional','enterprise'));
alter table public.subscriptions add constraint subscriptions_plan_check check (plan in ('advisor','office','professional','enterprise'));
alter table public.plan_entitlements add constraint plan_entitlements_plan_check check (plan in ('advisor', 'office', 'professional', 'enterprise'));
