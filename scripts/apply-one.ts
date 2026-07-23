import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const { Client } = pg;

const urls = [process.env.DATABASE_POOLER_URL, process.env.DATABASE_URL].filter(
  Boolean,
) as string[];

const file = process.argv[2];
if (!file) throw new Error("usage: tsx scripts/apply-one.ts <migration-file>");
if (urls.length === 0) throw new Error("DATABASE_POOLER_URL or DATABASE_URL missing");

async function main() {
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
      console.log("connected via", url.replace(/:[^:@]+@/, ":****@"));
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
  if (!client) throw new Error("No DB connection worked");

  const sql = fs.readFileSync(path.resolve(file), "utf8");
  console.log("running", file);
  await client.query(sql);
  console.log("ok", file);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
