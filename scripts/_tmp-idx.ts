import pg from "pg";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
const { Client } = pg;
const urls = [process.env.DATABASE_POOLER_URL, process.env.DATABASE_URL].filter(Boolean) as string[];
async function main() {
  let client: InstanceType<typeof Client> | null = null;
  for (const url of urls) {
    const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
    try { await c.connect(); client = c; break; } catch { try { await c.end(); } catch {} }
  }
  if (!client) throw new Error("no db");
  try {
    // Diagnostic helper only. Never accept operator-supplied SQL and make the
    // server enforce read-only mode even if this file changes accidentally.
    await client.query("begin read only");
    const result = await client.query(
      "select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by tablename, indexname",
    );
    console.log(JSON.stringify(result.rows, null, 1));
    await client.query("rollback");
  } finally {
    await client.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
