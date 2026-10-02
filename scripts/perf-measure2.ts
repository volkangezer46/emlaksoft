/**
 * Performans ölçümü 2 — TAMAMEN SALT-OKUNUR (default_transaction_read_only=on, begin read only, ROLLBACK).
 * DDL/INSERT/UPDATE/DELETE yok. Bağlantı dizesi ve kullanıcı e-postaları yazdırılmaz.
 * Modlar: --stats (pg_stat_statements + tablo boyutları + tenant dağılımı + politikalar)
 *         --explain[=seqoff] (tenant başına EXPLAIN ANALYZE; --tenant=<uuid|biggest|demo>; --full)
 */
import dotenv from "dotenv";
import { Client } from "pg";
dotenv.config({ path: process.env.PERF_ENV_FILE ?? "C:/Users/volka/Projects/emlaksoft/.env.local", quiet: true });

const DEMO = "c361a876-ed18-4ce5-983c-5466b4cfd11a";
const arg = (n: string) => {
  const a = process.argv.find((x) => x === `--${n}` || x.startsWith(`--${n}=`));
  return a ? (a.includes("=") ? a.split("=")[1] : "1") : undefined;
};

async function stats(c: Client) {
  const q = async (s: string) => (await c.query(s)).rows;
  console.log("== eklentiler");
  console.log((await q("select extname from pg_extension where extname in ('pg_stat_statements','pg_trgm','hypopg')")).map((r) => r.extname).join(","));
  console.log("== top20 toplam süre");
  for (const r of await q(`select calls, round(total_exec_time::numeric/1000,1) total_s, round(mean_exec_time::numeric,2) mean_ms,
      round(max_exec_time::numeric,0) max_ms, rows, shared_blks_read, regexp_replace(left(query,170), '\\s+',' ','g') q
      from pg_stat_statements order by total_exec_time desc limit 20`))
    console.log(`${r.calls} | ${r.total_s}s | mean ${r.mean_ms} | max ${r.max_ms} | rows ${r.rows} | blksread ${r.shared_blks_read} | ${r.q}`);
  console.log("== top15 ortalama süre (calls>=50)");
  for (const r of await q(`select calls, round(mean_exec_time::numeric,1) mean_ms, round(total_exec_time::numeric/1000,1) total_s,
      regexp_replace(left(query,170), '\\s+',' ','g') q from pg_stat_statements where calls>=50 order by mean_exec_time desc limit 15`))
    console.log(`${r.calls} | mean ${r.mean_ms} | ${r.total_s}s | ${r.q}`);
  console.log("== tenant başına satır sayıları (ilk 6)");
  for (const r of await q(`select t.id, t.slug,
      (select count(*) from customers where tenant_id=t.id) cust,
      (select count(*) from properties where tenant_id=t.id) prop,
      (select count(*) from customer_demands where tenant_id=t.id) dem,
      (select count(*) from appointments where tenant_id=t.id) appt,
      (select count(*) from tasks where tenant_id=t.id) tasks,
      (select count(*) from communications where tenant_id=t.id) comm,
      (select count(*) from commissions where tenant_id=t.id) commis,
      (select count(*) from deals where tenant_id=t.id) deals
      from tenants t order by 3 desc limit 6`)) console.log(JSON.stringify(r));
  console.log("== en büyük tablolar");
  for (const r of await q(`select relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) sz, seq_scan, seq_tup_read, idx_scan, n_tup_ins, n_tup_upd, n_tup_del
      from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 15`)) console.log(JSON.stringify(r));
  console.log("== seq_scan sıralı");
  for (const r of await q(`select relname, n_live_tup, seq_scan, seq_tup_read, idx_scan from pg_stat_user_tables order by seq_scan desc limit 8`)) console.log(JSON.stringify(r));
  console.log("== support_tickets / notifications / profiles / tenants politikaları");
  for (const r of await q(`select tablename, policyname, cmd, qual, with_check from pg_policies where schemaname='public' and tablename in ('support_tickets','notifications','profiles','tenants') order by 1,2`))
    console.log(`${r.tablename}.${r.policyname} [${r.cmd}] USING ${r.qual} CHECK ${r.with_check}`);
}

async function explain(c: Client) {
  const tArg = arg("tenant") ?? "biggest";
  let tenant = DEMO;
  if (tArg === "biggest") tenant = (await c.query("select tenant_id from customers group by 1 order by count(*) desc limit 1")).rows[0].tenant_id;
  else if (tArg !== "demo") tenant = tArg;
  const u = (await c.query("select id from profiles where tenant_id=$1 and role in ('owner','admin') order by (role='owner') desc limit 1", [tenant])).rows[0];
  if (!u) throw new Error("tenant için owner profili yok");
  const claims = JSON.stringify({ sub: u.id, role: "authenticated", aud: "authenticated", app_metadata: { tenant_id: tenant, role: "owner" } });
  if (arg("explain") === "seqoff") await c.query("set local enable_seqscan = off");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims',$1,true), set_config('request.jwt.claim.sub',$2,true), set_config('request.jwt.claim.role','authenticated',true)", [claims, u.id]);
  const t = `tenant_id='${tenant}'`;
  const U = u.id;
  const Q: [string, string][] = [
    ["customers.liste", `select * from customers where ${t} and deleted_at is null order by created_at desc limit 25`],
    ["customers.ilike", `select * from customers where ${t} and deleted_at is null and (full_name ilike '%ahmet%' or phone ilike '%ahmet%' or email ilike '%ahmet%') order by created_at desc limit 25`],
    ["customers.count", `select count(*) from customers where ${t} and deleted_at is null`],
    ["properties.liste", `select * from properties where ${t} and deleted_at is null order by created_at desc limit 25`],
    ["properties.ilike", `select id from properties where ${t} and deleted_at is null and (title ilike '%daire%' or property_code ilike '%daire%' or address_line ilike '%daire%') order by created_at desc limit 25`],
    ["demands.liste", `select * from customer_demands where ${t} order by created_at desc limit 25`],
    ["demands.active", `select * from customer_demands where ${t} and status='active' order by created_at desc limit 25`],
    ["appointments.yaklasan", `select * from appointments where ${t} and scheduled_at > now() order by scheduled_at limit 50`],
    ["appointments.benim", `select * from appointments where ${t} and assigned_to='${U}' and scheduled_at > now() order by scheduled_at limit 50`],
    ["tasks.benim_acik", `select * from tasks where ${t} and assigned_to='${U}' and status<>'done' order by due_at limit 50`],
    ["tasks.gecikmis", `select count(*) from tasks where ${t} and status<>'done' and due_at < now()`],
    ["communications.inbox", `select * from communications where ${t} order by created_at desc limit 50`],
    ["communications.musteri", `select * from communications where ${t} and customer_id=(select id from customers where ${t} limit 1) order by created_at desc limit 20`],
    ["commissions.liste", `select * from commissions where ${t} order by created_at desc limit 50`],
    ["commissions.pending", `select * from commissions where ${t} and status='pending' order by created_at desc limit 50`],
    ["deals.liste", `select * from deals where ${t} order by updated_at desc limit 200`],
    ["notifications.sayac", `select count(*) from notifications where ${t} and user_id='${U}' and read_at is null`],
    ["support_tickets.liste", `select * from support_tickets where ${t} order by created_at desc limit 30`],
    ["profiles.liste", `select * from profiles where tenant_id='${tenant}' limit 50`],
  ];
  console.log(`tenant=${tenant === DEMO ? "demo-ofis" : "biggest"} seqoff=${arg("explain") === "seqoff"}`);
  console.log("ad | plan_ms | exec_ms | rowsRemovedByFilter(max) | seq | idx | buffers | InitPlan");
  for (const [ad, sql] of Q) {
    try {
      await c.query("savepoint s");
      await c.query(`explain (analyze, buffers) ${sql}`);
      const r = await c.query(`explain (analyze, buffers) ${sql}`);
      const x = r.rows.map((z: Record<string, string>) => z["QUERY PLAN"]).join("\n");
      const g = (re: RegExp) => [...x.matchAll(re)].map((m) => m[1]);
      const rm = Math.max(0, ...g(/Rows Removed by Filter: (\d+)/g).map(Number));
      const hit = Math.max(0, ...g(/shared hit=(\d+)/g).map(Number));
      const idx = [...new Set([...g(/Index (?:Only )?Scan(?: Backward)? using (\w+)/g), ...g(/Bitmap Index Scan on (\w+)/g)])];
      console.log(`${ad} | ${/Planning Time: ([\d.]+)/.exec(x)?.[1]} | ${/Execution Time: ([\d.]+)/.exec(x)?.[1]} | ${rm} | ${g(/Seq Scan on (\w+)/g).join(",") || "-"} | ${idx.join(",") || "-"} | ${hit} | ${(x.match(/InitPlan/g) ?? []).length}`);
      if (arg("full")) console.log(x.split("\n").map((l) => "    " + l).join("\n"));
      await c.query("release savepoint s");
    } catch (e) {
      console.log(`${ad} | HATA ${(e as Error).message.slice(0, 100)}`);
      await c.query("rollback to savepoint s");
    }
  }
}

async function main() {
  if (!process.env.DATABASE_POOLER_URL) throw new Error("DATABASE_POOLER_URL yok");
  const c = new Client({ connectionString: process.env.DATABASE_POOLER_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query("set default_transaction_read_only = on");
    await c.query("begin read only");
    if (arg("stats")) await stats(c);
    if (arg("explain")) await explain(c);
    if (arg("indexes")) {
      const r = await c.query(`select tablename, indexname, regexp_replace(indexdef,'^CREATE (UNIQUE )?INDEX \\S+ ON public\\.','') d
        from pg_indexes where schemaname='public' and tablename = any($1) order by 1,2`,
        [["customers", "properties", "customer_demands", "appointments", "tasks", "communications", "calls", "commissions", "deals", "notifications", "portal_listings", "geo_provinces", "geo_districts"]]);
      for (const x of r.rows) console.log(`${x.tablename} | ${x.indexname} | ${x.d}`);
    }
  } finally {
    await c.query("rollback").catch(() => {});
    await c.end();
  }
}
main().catch((e) => {
  console.error("HATA:", (e as Error).message.replace(/postgres(ql)?:\/\/\S+/g, "***"));
  process.exit(1);
});
