/**
 * Retired historical one-off. Replaying a migration outside the canonical
 * runner can corrupt the forward-only ledger contract.
 */

throw new Error(
  "Tekil migration bypass'ı kapalıdır. `npm run db:migrate -- --dry-run` çalıştırın.",
);
