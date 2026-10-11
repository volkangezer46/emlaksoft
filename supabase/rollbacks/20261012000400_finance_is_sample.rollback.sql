-- Rollback: 20261012000400_finance_is_sample
-- Örnek veri işaret kolonlarını düşürür. Satırlar KALIR; yalnız "örnek" işareti kaybolur (Gerçek kullanıma geç temizliği bu
-- tablolardaki örnek satırları artık tanıyamaz). Veri silinmez.

alter table public.expense_budgets  drop column if exists is_sample;
alter table public.recurring_rules  drop column if exists is_sample;
alter table public.cash_entries     drop column if exists is_sample;
alter table public.finance_accounts drop column if exists is_sample;
