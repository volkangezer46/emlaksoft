-- ARCHIVED / DO NOT APPLY
--
-- This old bundle predated schema_migrations checksums and later security
-- hardenings. Running it in SQL Editor would bypass the canonical forward-only
-- inventory and can recreate obsolete policies.
--
-- Use:
--   npm run db:migrate -- --dry-run
-- Then follow MIGRATION_GUIDE.md if selective ledger reconciliation is needed.

do $$
begin
  raise exception
    'apply_premium_plus.sql is retired; use the checksum-tracked migration runner';
end;
$$;
