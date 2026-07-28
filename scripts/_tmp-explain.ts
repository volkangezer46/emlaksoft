import pg from "pg";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
const c = new pg.Client({
  connectionString: process.env.DATABASE_POOLER_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const QS = [
  "select id from public.deals where tenant_id='00000000-0000-0000-0000-000000000000' order by updated_at desc limit 200",
  "select id from public.customers where tenant_id='00000000-0000-0000-0000-000000000000' and deleted_at is null order by full_name limit 200",
  "select id from public.properties where tenant_id='00000000-0000-0000-0000-000000000000' and deleted_at is null and status in ('live','reserved') order by created_at desc limit 200",
  "select id from public.property_media where property_id='00000000-0000-0000-0000-000000000000' and kind='image' and is_cover",
  "select id from public.customers where tenant_id='00000000-0000-0000-0000-000000000000' and customer_types @> array['Alıcı']::text[]",
  "select id from public.appointments where tenant_id='00000000-0000-0000-0000-000000000000' and assigned_to='00000000-0000-0000-0000-000000000000' and scheduled_at > now() order by scheduled_at limit 50",
];
(async () => {
  await c.connect();
  await c.query("set enable_seqscan=off");
  for (const q of QS) {
    const r = await c.query("explain (costs off) " + q);
    console.log("--- " + q.slice(0, 70));
    console.log(r.rows.map((x: Record<string, string>) => x["QUERY PLAN"]).join("\n"));
  }
  await c.end();
})();
