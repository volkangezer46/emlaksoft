import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const { Client } = pg;
const file = "supabase/migrations/20260722000008_workflow_extras.sql";

async function main() {
  const urls = [process.env.DATABASE_POOLER_URL, process.env.DATABASE_URL].filter(Boolean) as string[];
  if (!urls.length) throw new Error("DATABASE_POOLER_URL or DATABASE_URL missing");

  let client: InstanceType<typeof Client> | null = null;
  for (const url of urls) {
    const c = new Client({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    });
    try {
      await c.connect();
      client = c;
      console.log("connected");
      break;
    } catch (err) {
      console.log("fail", String(err).slice(0, 120));
      try {
        await c.end();
      } catch {
        /* ignore */
      }
    }
  }
  if (!client) throw new Error("No DB connection");

  const sql = fs.readFileSync(path.resolve(file), "utf8");
  console.log("running", file);
  await client.query(sql);
  console.log("ok");

  const { rows } = await client.query(
    `select table_name from information_schema.tables
     where table_schema='public'
       and table_name in ('payment_links','share_links','valuations','iys_consents')
     order by 1`,
  );
  console.log("tables", rows.map((r) => r.table_name));
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
