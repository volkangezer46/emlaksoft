/**
 * Performans ölçümü: uygulamanın en sık sorgularının planlarını RLS ALTINDA çözümler.
 *
 * SALT-OKUNUR: tek transaction `begin read only`, sonunda ROLLBACK. Yalnız SELECT
 * EXPLAIN (ANALYZE, BUFFERS) çalıştırılır. İsteğe bağlı `--try-index` ile
 * (DDL) bir index'i AYNI transaction içinde dener — ancak `read only` transaction'da
 * DDL yapılamaz; bu yüzden o mod ayrı bir yazılabilir transaction açar ve ROLLBACK eder
 * (kanonik kullanım: yalnız `supabase/proposed/*` dosyasındaki index'lerin etkisini ölçmek).
 * Canlıya kalıcı hiçbir şey yazılmaz.
 *
 * Bağlam: 'authenticated' rolü + gerçek claim'ler (sub, role, app_metadata.tenant_id/role)
 * demo-ofis 'sahip@demo.emlaksoft.test' kullanıcısı için.
 *
 * Bağlantı: ana projenin .env.local dosyası (PERF_ENV_FILE ile değiştirilebilir),
 * DATABASE_POOLER_URL. Bağlantı dizesi ASLA yazdırılmaz.
 *
 * Çalıştırma:
 *   npx tsx scripts/perf-explain.ts                 # özet tablo
 *   npx tsx scripts/perf-explain.ts --full          # tam planlar
 *   npx tsx scripts/perf-explain.ts --only=customers  # ad filtresi
 *   npx tsx scripts/perf-explain.ts --seqscan-off   # küçük tabloda index planını zorla (ölçekli senaryo simülasyonu)
 *   npx tsx scripts/perf-explain.ts --try-index=supabase/proposed/20260814_perf_indexes.sql
 *   npx tsx scripts/perf-explain.ts --audit         # pg_stat/pg_policies denetimi (çift/kullanılmayan index, sarılmamış çağrılar)
 *
 * UYARI: Demo tenant küçük (onlarca satır); planlayıcı küçük tabloda zaten seq scan seçer.
 * `--seqscan-off` ile index'in KULLANILABİLİRLİĞİ doğrulanır, ölçekli süre kanıtlanmaz.
 */
import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { Client } from "pg";

dotenv.config({
  path: process.env.PERF_ENV_FILE ?? "C:/Users/volka/Projects/emlaksoft/.env.local",
  quiet: true,
});

const TENANT = "c361a876-ed18-4ce5-983c-5466b4cfd11a"; // demo-ofis
const USER = "4c43415e-a445-4354-a677-3871cc6b933f"; // sahip@demo.emlaksoft.test
const CLAIMS = JSON.stringify({
  sub: USER,
  role: "authenticated",
  aud: "authenticated",
  email: "sahip@demo.emlaksoft.test",
  app_metadata: { tenant_id: TENANT, role: "owner" },
});

type Q = { ad: string; sql: string };
const t = `tenant_id = '${TENANT}'`;

const QUERIES: Q[] = [
  // --- Müşteriler
  { ad: "customers.liste", sql: `select * from public.customers where ${t} and deleted_at is null order by created_at desc limit 25` },
  { ad: "customers.liste_rls_only", sql: `select * from public.customers where deleted_at is null order by created_at desc limit 25` },
  { ad: "customers.ad_sirala", sql: `select * from public.customers where ${t} and deleted_at is null order by full_name limit 25` },
  { ad: "customers.ilike_ad", sql: `select * from public.customers where ${t} and deleted_at is null and (full_name ilike '%ahmet%' or phone ilike '%ahmet%' or email ilike '%ahmet%') order by created_at desc limit 25` },
  { ad: "customers.tip_filtre", sql: `select id from public.customers where ${t} and deleted_at is null and customer_types @> array['Alıcı']::text[] order by created_at desc limit 25` },
  { ad: "customers.sayac", sql: `select count(*) from public.customers where ${t} and deleted_at is null` },
  { ad: "customers.kaynak", sql: `select id from public.customers where ${t} and deleted_at is null and source = 'web' order by created_at desc limit 25` },
  // --- Portföy
  { ad: "properties.liste", sql: `select * from public.properties where ${t} and deleted_at is null order by created_at desc limit 25` },
  { ad: "properties.status", sql: `select * from public.properties where ${t} and deleted_at is null and status = 'live' order by created_at desc limit 25` },
  { ad: "properties.ilike", sql: `select id from public.properties where ${t} and deleted_at is null and (title ilike '%daire%' or property_code ilike '%daire%' or address_line ilike '%daire%') order by created_at desc limit 25` },
  { ad: "properties.islem_tipi", sql: `select id from public.properties where ${t} and deleted_at is null and transaction_type = 'sale' order by created_at desc limit 25` },
  { ad: "properties.sayac_status", sql: `select status, count(*) from public.properties where ${t} and deleted_at is null group by status` },
  // --- Talepler
  { ad: "demands.liste", sql: `select * from public.customer_demands where ${t} order by created_at desc limit 25` },
  { ad: "demands.status", sql: `select * from public.customer_demands where ${t} and status = 'active' order by created_at desc limit 25` },
  { ad: "demands.musteri", sql: `select * from public.customer_demands where ${t} and customer_id = (select id from public.customers where ${t} limit 1)` },
  // --- Randevular
  { ad: "appointments.yaklasan", sql: `select * from public.appointments where ${t} and scheduled_at > now() order by scheduled_at limit 50` },
  { ad: "appointments.benim", sql: `select * from public.appointments where ${t} and assigned_to = '${USER}' and scheduled_at > now() order by scheduled_at limit 50` },
  { ad: "appointments.status", sql: `select * from public.appointments where ${t} and status = 'scheduled' order by scheduled_at limit 50` },
  // --- Anlaşmalar / komisyon
  { ad: "deals.liste", sql: `select * from public.deals where ${t} order by updated_at desc limit 200` },
  { ad: "deals.stage", sql: `select * from public.deals where ${t} and stage = 'won' order by updated_at desc limit 50` },
  { ad: "deals+commissions", sql: `select d.id, c.gross_amount from public.deals d left join public.commissions c on c.deal_id = d.id where d.${t} order by d.updated_at desc limit 50` },
  { ad: "commissions.liste", sql: `select * from public.commissions where ${t} order by created_at desc limit 50` },
  { ad: "commissions.status", sql: `select * from public.commissions where ${t} and status = 'pending' order by created_at desc limit 50` },
  // --- Birleşik akış
  { ad: "akis.calls+communications", sql: `select * from (
      (select 'call' k, id, started_at at from public.calls where ${t} order by started_at desc limit 30)
      union all
      (select 'comm' k, id, created_at at from public.communications where ${t} order by created_at desc limit 30)
    ) x order by at desc limit 30` },
  { ad: "calls.musteri", sql: `select * from public.calls where ${t} and customer_id = (select id from public.customers where ${t} limit 1) order by started_at desc limit 20` },
  { ad: "communications.musteri", sql: `select * from public.communications where ${t} and customer_id = (select id from public.customers where ${t} limit 1) order by created_at desc limit 20` },
  // --- Denetim / bildirim / görev
  { ad: "audit_logs.son", sql: `select * from public.audit_logs where ${t} order by created_at desc limit 50` },
  { ad: "audit_logs.eylem", sql: `select * from public.audit_logs where ${t} and action ilike '%customer%' order by created_at desc limit 50` },
  { ad: "notifications.liste", sql: `select * from public.notifications where ${t} and user_id = '${USER}' order by created_at desc limit 30` },
  { ad: "notifications.okunmamis_sayac", sql: `select count(*) from public.notifications where ${t} and user_id = '${USER}' and read_at is null` },
  { ad: "tasks.benim_acik", sql: `select * from public.tasks where ${t} and assigned_to = '${USER}' and status <> 'done' order by due_at limit 50` },
  { ad: "tasks.gecikmis_sayac", sql: `select count(*) from public.tasks where ${t} and status <> 'done' and due_at < now()` },
  // --- Dashboard sayaçları (tek sorguda)
  {
    ad: "dashboard.sayaclar",
    sql: `select
      (select count(*) from public.customers where ${t} and deleted_at is null) musteri,
      (select count(*) from public.properties where ${t} and deleted_at is null and status = 'live') ilan,
      (select count(*) from public.customer_demands where ${t} and status = 'active') talep,
      (select count(*) from public.appointments where ${t} and scheduled_at >= now() and scheduled_at < now() + interval '7 days') randevu,
      (select count(*) from public.deals where ${t} and stage not in ('won','lost')) acik_anlasma,
      (select count(*) from public.tasks where ${t} and status <> 'done') gorev`,
  },
  // --- Fonksiyon maliyeti
  { ad: "fn.current_active_tenant_id", sql: `select public.current_active_tenant_id()` },
  { ad: "fn.current_profile_role", sql: `select public.current_profile_role()` },
  { ad: "fn.has_effective_permission", sql: `select public.has_effective_permission('customers','view')` },
  { ad: "fn.x1000_has_effective_permission", sql: `select count(*) from generate_series(1,1000) g where public.has_effective_permission('customers','view')` },
];

function arg(name: string): string | undefined {
  const a = process.argv.find((x) => x === `--${name}` || x.startsWith(`--${name}=`));
  if (!a) return undefined;
  return a.includes("=") ? a.split("=")[1] : "1";
}

async function setContext(c: Client) {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', 'authenticated', true)", [CLAIMS, USER]);
}

function summarize(plan: string[]) {
  const txt = plan.join("\n");
  const exec = /Execution Time: ([\d.]+) ms/.exec(txt)?.[1] ?? "?";
  const planning = /Planning Time: ([\d.]+) ms/.exec(txt)?.[1] ?? "?";
  const seq = [...txt.matchAll(/Seq Scan on (\w+)/g)].map((m) => m[1]);
  const idx = [...txt.matchAll(/Index (?:Only )?Scan(?: Backward)? using (\w+)/g)].map((m) => m[1]);
  const bmp = [...txt.matchAll(/Bitmap Index Scan on (\w+)/g)].map((m) => m[1]);
  const hit = [...txt.matchAll(/shared hit=(\d+)/g)].map((m) => Number(m[1])).sort((a, b) => b - a)[0] ?? 0;
  const initp = (txt.match(/InitPlan/g) ?? []).length;
  return { exec, planning, seq, idx: [...idx, ...bmp], hit, initp };
}

async function runQueries(c: Client, label: string) {
  const only = arg("only");
  const full = !!arg("full");
  console.log(`\n=== ${label} ===`);
  console.log("ad | plan_ms | exec_ms | buffers_hit | InitPlan | seq_scan | index");
  for (const q of QUERIES) {
    if (only && !q.ad.includes(only)) continue;
    try {
      await c.query("savepoint s");
      // ısınma + ölçüm (ikincisi raporlanır)
      await c.query(`explain (analyze, buffers) ${q.sql}`);
      const r = await c.query(`explain (analyze, buffers) ${q.sql}`);
      const lines = r.rows.map((x: Record<string, string>) => x["QUERY PLAN"]);
      const s = summarize(lines);
      console.log(`${q.ad} | ${s.planning} | ${s.exec} | ${s.hit} | ${s.initp} | ${s.seq.join(",") || "-"} | ${[...new Set(s.idx)].join(",") || "-"}`);
      if (full) console.log(lines.map((l) => "    " + l).join("\n"));
      await c.query("release savepoint s");
    } catch (e) {
      console.log(`${q.ad} | HATA: ${(e as Error).message.slice(0, 120)}`);
      await c.query("rollback to savepoint s");
    }
  }
}

async function audit(c: Client) {
  const q = async (s: string) => (await c.query(s)).rows;
  console.log("\n=== Kullanılmayan index'ler (idx_scan=0, pkey/unique hariç) ===");
  for (const r of await q(`select s.relname tablo, s.indexrelname idx, s.idx_scan, pg_relation_size(s.indexrelid)/1024 kb
    from pg_stat_user_indexes s join pg_index i on i.indexrelid=s.indexrelid
    where s.schemaname='public' and s.idx_scan=0 and not i.indisunique and not i.indisprimary order by 4 desc limit 60`))
    console.log(`${r.tablo}.${r.idx} scan=${r.idx_scan} ${r.kb}kB`);
  console.log("\n=== Çift/öneki kapsanan index'ler (aynı tablo, başka bir index'in öneki) ===");
  for (const r of await q(`select a.indrelid::regclass tablo, ai.relname kucuk, bi.relname kapsayan
    from pg_index a join pg_index b on a.indrelid=b.indrelid and a.indexrelid<>b.indexrelid
    join pg_class ai on ai.oid=a.indexrelid join pg_class bi on bi.oid=b.indexrelid
    where not a.indisunique and not a.indisprimary and a.indpred is null and b.indpred is null
    and a.indexprs is null and b.indexprs is null
    and (string_to_array(a.indkey::text,' '))[1:a.indnkeyatts] = (string_to_array(b.indkey::text,' '))[1:a.indnkeyatts]
    and (a.indnkeyatts < b.indnkeyatts or (a.indnkeyatts = b.indnkeyatts and a.indexrelid > b.indexrelid))
    and a.indrelid::regclass::text not like 'pg_%' and a.indrelid::regclass::text not like 'auth.%' and a.indrelid::regclass::text not like 'storage.%'
    order by 1,2`))
    console.log(`${r.tablo}: ${r.kucuk}  ⊂  ${r.kapsayan}`);
  console.log("\n=== Tablo seq_scan / idx_scan (seq çok olanlar) ===");
  for (const r of await q(`select relname, n_live_tup, seq_scan, idx_scan, seq_tup_read from pg_stat_user_tables where schemaname='public' order by seq_tup_read desc limit 15`))
    console.log(`${r.relname} live=${r.n_live_tup} seq=${r.seq_scan} idx=${r.idx_scan} seq_tup_read=${r.seq_tup_read}`);
  console.log("\n=== RLS politikalarında sarılmamış (SELECT ...) auth/current_* çağrıları (kaba regex; elle doğrula) ===");
  const fn = /(auth\.uid|auth\.jwt|current_[a-z_]+|has_effective_permission|is_platform_staff)\(/g;
  for (const p of await q(`select tablename, policyname, coalesce(qual,'')||' ¦ '||coalesce(with_check,'') e from pg_policies where schemaname='public' order by 1,2`)) {
    let n = 0, w = 0, m: RegExpExecArray | null;
    fn.lastIndex = 0;
    while ((m = fn.exec(p.e))) {
      n++;
      if (/select\s+$/i.test(p.e.slice(Math.max(0, m.index - 8), m.index))) w++;
    }
    if (n > w) console.log(`${p.tablename}.${p.policyname} cagri=${n} sarili=${w}`);
  }
}

async function tryIndex(file: string) {
  // DİKKAT: yazılabilir transaction, SONUNDA ROLLBACK. CONCURRENTLY satırları atlanır/dönüştürülür.
  const sql = readFileSync(file, "utf8").replace(/concurrently\s+/gi, "");
  const c = new Client({ connectionString: process.env.DATABASE_POOLER_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query("begin");
    await c.query("set local lock_timeout = '3s'");
    await c.query("set local statement_timeout = '60s'");
    await c.query("set local enable_seqscan = off");
    // önce ÖNCE
    await setContext(c);
    await runQueries(c, "ÖNCE (seqscan=off)");
    await c.query("reset role");
    await c.query(sql);
    await c.query("analyze");
    await setContext(c);
    await runQueries(c, "SONRA (seqscan=off, önerilen index'ler)");
  } finally {
    await c.query("rollback").catch(() => {});
    await c.end();
  }
}

async function main() {
  if (!process.env.DATABASE_POOLER_URL) throw new Error("DATABASE_POOLER_URL yok (PERF_ENV_FILE kontrol et)");
  const tryFile = arg("try-index");
  if (tryFile) return tryIndex(tryFile);
  const c = new Client({ connectionString: process.env.DATABASE_POOLER_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query("begin read only");
    if (arg("audit")) {
      await audit(c);
    } else {
      if (arg("seqscan-off")) await c.query("set local enable_seqscan = off");
      await setContext(c);
      await runQueries(c, arg("seqscan-off") ? "RLS altında (seqscan=off)" : "RLS altında (varsayılan planlayıcı)");
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
