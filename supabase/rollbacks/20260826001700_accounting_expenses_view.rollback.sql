-- Rollback: 20260826001700_accounting_expenses_view. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- Yalniz bu migration'in ekledigi satiri siler (muhasebe expenses view varsayilani).
delete from public.permission_defaults where role = 'accounting' and module = 'expenses' and action = 'view';
