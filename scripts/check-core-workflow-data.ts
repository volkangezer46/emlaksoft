/** Read-only production preflight for the atomic core-workflow cut-over. */
import dotenv from "dotenv";
import pg from "pg";
import {
  CORE_WORKFLOW_PREFLIGHT_SQL,
  coreWorkflowBlockerTotal,
  formatCoreWorkflowCounts,
  type CoreWorkflowPreflightRow,
} from "../src/lib/core-workflow-preflight";

dotenv.config({ path: ".env.local", quiet: true });

const databaseUrl = process.env.DATABASE_POOLER_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_POOLER_URL veya DATABASE_URL gerekli");

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20_000,
});

async function main() {
  await client.connect();
  try {
    await client.query("begin read only");
    const scaffold = await client.query<{ present: boolean }>(`
      select exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'deals'
          and column_name = 'closure_active'
      ) and exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'rentals'
          and column_name = 'deal_id'
      ) as present
    `);
    if (!scaffold.rows[0]?.present) {
      throw new Error("Önce 20260812000000_core_workflow_scaffold.sql uygulanmalı; hiçbir veri değiştirilmedi.");
    }
    const result = await client.query<CoreWorkflowPreflightRow>(CORE_WORKFLOW_PREFLIGHT_SQL);
    const row = result.rows[0] ?? {};
    console.log(`Core workflow preflight: ${formatCoreWorkflowCounts(row)}`);
    const blockers = coreWorkflowBlockerTotal(row);
    if (blockers > 0) {
      throw new Error(`Core workflow reconciliation gerekli: ${blockers} blocker; migration uygulanmamalı.`);
    }
    console.log("Core workflow preflight PASS — blocker yok; sorgu salt okunurdu.");
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
