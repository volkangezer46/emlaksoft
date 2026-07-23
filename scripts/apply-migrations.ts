import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const { Client } = pg;

const urls = [
  process.env.DATABASE_POOLER_URL,
  process.env.DATABASE_URL,
].filter(Boolean) as string[];

if (urls.length === 0) {
  throw new Error("DATABASE_POOLER_URL or DATABASE_URL missing");
}

const files = [
  "supabase/migrations/20260721000000_init.sql",
  "supabase/migrations/20260721000001_geo_seed.sql",
  "supabase/migrations/20260721000002_jwt_claims.sql",
  "supabase/migrations/20260721000003_grants.sql",
  "supabase/migrations/20260721000004_appointments.sql",
  "supabase/migrations/20260722000005_platform_staff.sql",
  "supabase/migrations/20260722000006_billing_tickets.sql",
  "supabase/migrations/20260722000007_notifications_audit.sql",
  "supabase/migrations/20260722000008_workflow_extras.sql",
];

async function main() {
  let client: InstanceType<typeof Client> | null = null;
  let used = "";

  for (const url of urls) {
    const c = new Client({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    });
    try {
      await c.connect();
      client = c;
      used = url.replace(/:[^:@]+@/, ":****@");
      console.log("connected via", used);
      break;
    } catch (err) {
      console.log("fail", url.replace(/:[^:@]+@/, ":****@"), String(err).slice(0, 120));
      try {
        await c.end();
      } catch {
        /* ignore */
      }
    }
  }

  if (!client) throw new Error("No DB connection worked");

  for (const file of files) {
    const sql = fs.readFileSync(path.resolve(file), "utf8");
    console.log("running", file);
    await client.query(sql);
    console.log("ok", file);
  }

  const { rows } = await client.query(
    "select count(*)::int as n from public.geo_provinces",
  );
  console.log("geo_provinces", rows[0].n);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
