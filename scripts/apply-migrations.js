#!/usr/bin/env node

/**
 * Retired compatibility entry point.
 *
 * The historical script sent a monolithic SQL file to a privileged `exec_sql`
 * RPC. That bypassed the forward-only inventory, advisory lock, transaction,
 * checksum and ledger reconciliation gates in `apply-migrations.ts`.
 *
 * Keep this filename fail-closed for old bookmarks/automation: operators get a
 * safe migration command instead of accidentally using the legacy bypass.
 */

console.error(
  [
    "Bu migration aracı güvenlik nedeniyle kullanımdan kaldırıldı.",
    "Önce salt-okunur önizleme çalıştırın:",
    "  npm run db:migrate -- --dry-run",
    "Ledger/şema ayrışması varsa MIGRATION_GUIDE.md içindeki seçici uzlaştırma prosedürünü izleyin.",
  ].join("\n"),
);
process.exitCode = 1;
