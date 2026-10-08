-- Rollback: 20261008000700_expense_budgets_recurring_portal
-- Bütçe tablosu ve expenses.recurrence / expenses.portal_key düşer (bu sütunlardaki veri kaybolur; gider kayıtları kalır).
-- Kod sütunlar yokken tekrarlayan/portal/bütçe özelliklerini gizler ve eski gider akışı çalışır.

set local lock_timeout = '5s';

drop index if exists public.idx_expenses_tenant_portal;
drop index if exists public.idx_expenses_tenant_recurrence;

alter table public.expenses drop constraint if exists expenses_portal_key_check;
alter table public.expenses drop constraint if exists expenses_recurrence_check;
alter table public.expenses drop column if exists portal_key;
alter table public.expenses drop column if exists recurrence;

drop table if exists public.expense_budgets;

notify pgrst, 'reload schema';
