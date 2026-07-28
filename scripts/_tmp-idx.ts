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
  const q = process.argv[2] ?? `select tablename, indexname, indexdef from pg_indexes where schemaname='public' order by tablename, indexname`;
  const r = await client.query(q);
  console.log(JSON.stringify(r.rows, null, 1));
  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
