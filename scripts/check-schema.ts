/**
 * Şema denetimi: migration dosyalarının dev DB'de gerçekten karşılığı var mı?
 *
 * `npx tsx scripts/check-schema.ts` ile çalıştırılır. Salt-okunur — hiçbir şey
 * değiştirmez, yalnız beklenen tablo/kolon/fonksiyon/politikaları listeler.
 * Eksik çıkan varsa ilgili migration `npx tsx scripts/apply-one.ts <dosya>`
 * ile uygulanır.
 */
import pg from "pg";
import dotenv from "dotenv";
import { DEFAULT_MATRIX } from "../src/lib/permissions";

dotenv.config({ path: ".env.local" });

const { Client } = pg;

const urls = [process.env.DATABASE_POOLER_URL, process.env.DATABASE_URL].filter(
  Boolean,
) as string[];
if (urls.length === 0) throw new Error("DATABASE_POOLER_URL or DATABASE_URL missing");

/** Beklenen tablolar (migration dosyası → tablo adı) */
const TABLES: { table: string; migration: string }[] = [
  { table: "presentations", migration: "20260726000100_presentations.sql" },
  { table: "surveys", migration: "20260727000104_surveys.sql" },
  { table: "deal_checklist_items", migration: "20260727000103_deal_checklist.sql" },
  { table: "vitrin_price_alerts", migration: "20260727000105_vitrin_price_alerts.sql" },
  { table: "announcements", migration: "20260727000106_announcements.sql" },
  { table: "announcement_reads", migration: "20260727000106_announcements.sql" },
];

/** Beklenen kolonlar */
const COLUMNS: { table: string; column: string; migration: string }[] = [
  { table: "open_houses", column: "public_token", migration: "20260726000098_open_house_public.sql" },
  { table: "profiles", column: "calendar_token", migration: "20260726000099_calendar_token.sql" },
];

/** Beklenen fonksiyonlar */
const FUNCTIONS: { fn: string; migration: string }[] = [
  { fn: "geo_consistency_check", migration: "20260726000102_geo_consistency.sql" },
];

/** Beklenen RLS politikaları (tablo bazlı en az bir politika) */
const POLICIES: { table: string; migration: string }[] = [
  { table: "customer_files", migration: "20260727000107_customer_files_rls_fix.sql" },
  { table: "presentations", migration: "20260726000100_presentations.sql" },
  { table: "surveys", migration: "20260727000104_surveys.sql" },
  { table: "deal_checklist_items", migration: "20260727000103_deal_checklist.sql" },
  { table: "vitrin_price_alerts", migration: "20260727000105_vitrin_price_alerts.sql" },
  { table: "announcements", migration: "20260727000106_announcements.sql" },
  { table: "announcement_reads", migration: "20260727000106_announcements.sql" },
];

async function connect() {
  for (const url of urls) {
    const c = new Client({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    });
    try {
      await c.connect();
      console.log("connected via", url.replace(/:[^:@]+@/, ":****@"));
      return c;
    } catch {
      try { await c.end(); } catch { /* yoksay */ }
    }
  }
  throw new Error("DB baglantisi kurulamadi");
}

async function main() {
  const client = await connect();
  const missing: string[] = [];
  const ok = (s: string) => console.log("  OK   " + s);
  const bad = (s: string, migration: string) => {
    console.log("  EKSIK " + s + "   -> " + migration);
    missing.push(migration);
  };

  console.log("\n[tablolar]");
  for (const t of TABLES) {
    const r = await client.query("select to_regclass($1) as x", ["public." + t.table]);
    if (r.rows[0].x) ok(t.table); else bad(t.table, t.migration);
  }

  console.log("\n[kolonlar]");
  for (const c of COLUMNS) {
    const r = await client.query(
      "select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2",
      [c.table, c.column],
    );
    if (r.rowCount) ok(`${c.table}.${c.column}`); else bad(`${c.table}.${c.column}`, c.migration);
  }

  console.log("\n[fonksiyonlar]");
  for (const f of FUNCTIONS) {
    const r = await client.query(
      "select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1",
      [f.fn],
    );
    if (r.rowCount) ok(f.fn + "()"); else bad(f.fn + "()", f.migration);
  }

  console.log("\n[RLS politikalari]");
  for (const p of POLICIES) {
    const r = await client.query("select count(*)::int as n from pg_policies where schemaname='public' and tablename=$1", [p.table]);
    const n = r.rows[0].n as number;
    if (n > 0) ok(`${p.table} (${n} politika)`); else bad(`${p.table} (politika yok)`, p.migration);
  }

  // permission_defaults, src/lib/permissions.ts DEFAULT_MATRIX'in DB kopyasi olmali
  // (CLAUDE.md "yeni modul = 4 kayit yeri" kuralinin 4. ayagi). Iki yonlu karsilastirilir.
  console.log("\n[permission_defaults <-> DEFAULT_MATRIX]");
  const pd = await client.query<{ role: string; module: string; action: string }>(
    "select role, module, action from permission_defaults",
  );
  const dbSet = new Set(pd.rows.map((r) => `${r.role}|${r.module}|${r.action}`));
  const tsSet = new Set<string>();
  for (const [role, mods] of Object.entries(DEFAULT_MATRIX)) {
    for (const [mod, actions] of Object.entries(mods ?? {})) {
      for (const a of actions ?? []) tsSet.add(`${role}|${mod}|${a}`);
    }
  }
  const onlyTs = [...tsSet].filter((k) => !dbSet.has(k));
  const onlyDb = [...dbSet].filter((k) => !tsSet.has(k));
  console.log(`  TS: ${tsSet.size} kayit, DB: ${dbSet.size} kayit`);
  if (onlyTs.length) {
    console.log(`  EKSIK (TS'te var, DB'de yok) — ${onlyTs.length}:`);
    for (const k of onlyTs.slice(0, 30)) console.log("    " + k);
    missing.push("permission_defaults seed migration'i gerekli");
  }
  if (onlyDb.length) {
    console.log(`  FAZLA (DB'de var, TS'te yok) — ${onlyDb.length}:`);
    for (const k of onlyDb.slice(0, 30)) console.log("    " + k);
  }
  if (!onlyTs.length && !onlyDb.length) ok("matris birebir");

  await client.end();

  const uniq = [...new Set(missing)];
  if (uniq.length) {
    console.log("\nUYGULANMASI GEREKEN MIGRATIONLAR:");
    for (const m of uniq) console.log("  npx tsx scripts/apply-one.ts supabase/migrations/" + m);
    process.exit(1);
  }
  console.log("\nTumu mevcut.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
