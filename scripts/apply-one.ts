/**
 * Retired: applying one SQL file directly bypassed migration checksums, the
 * schema ledger and reconciliation guards. This filename remains as a
 * fail-closed compatibility entry point for old operator notes.
 */

throw new Error(
  "apply-one.ts kullanımdan kaldırıldı. Önce `npm run db:migrate -- --dry-run`; " +
    "seçici ledger uzlaştırması için MIGRATION_GUIDE.md kullanın.",
);
