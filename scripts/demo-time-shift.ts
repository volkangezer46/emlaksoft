/**
 * demo-ofis verisini "bugüne" kaydırır: canlı tablolardaki zaman damgaları TEK bir tam gün farkıyla ileri alınır
 * (kayıtlar arası sıra ve süreler korunur). Böylece demo girişinde bugünün randevuları, yeni talepler, bu ayın
 * ligi ve tazelik etiketleri dolu görünür. Fark: en yeni müşteri kaydı dün olacak şekilde hesaplanır; zaten
 * tazeyse (fark < 1 gün) hiçbir şey yapmaz.
 *
 * Güvenlik: yalnız `tenants.slug = 'demo-ofis'`; varsayılan DRY-RUN (transaction geri alınır), yazmak için `--apply`.
 * Kullanım: npx tsx scripts/demo-time-shift.ts [--apply]
 */
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local", quiet: true });

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_POOLER_URL || process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_POOLER_URL veya DATABASE_URL gerekli");

/** Tablo → kaydırılacak zaman sütunları (yalnız var olanlar uygulanır). */
const PLAN: Record<string, string[]> = {
  customers: ["created_at", "updated_at"],
  customer_demands: ["created_at"],
  properties: ["created_at", "updated_at", "published_at", "assigned_at"],
  appointments: ["scheduled_at", "created_at", "updated_at", "responded_at", "signed_at"],
  tasks: ["due_at", "created_at", "completed_at"],
  calls: ["started_at", "ended_at"],
  offers: ["created_at", "updated_at", "submitted_at", "responded_at"],
  deals: ["created_at", "updated_at"],
  notifications: ["created_at"],
  communications: ["created_at"],
  open_houses: ["starts_at", "ends_at", "created_at"],
};

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20_000 });

async function main() {
  await client.connect();
  try {
    await client.query("begin");
    const t = await client.query<{ id: string }>("select id from public.tenants where slug = 'demo-ofis'");
    const tenantId = t.rows[0]?.id;
    if (!tenantId) throw new Error("demo-ofis bulunamadı");

    const d = await client.query<{ days: number | null }>(
      `select floor(extract(epoch from (now() - interval '1 day' - max(created_at))) / 86400)::int as days
         from public.customers where tenant_id = $1`,
      [tenantId],
    );
    const days = d.rows[0]?.days ?? 0;
    console.log(`kaydırma: ${days} gün`);
    if (days < 1) {
      console.log("Veri zaten taze; değişiklik yok.");
      await client.query("rollback");
      return;
    }

    for (const [table, cols] of Object.entries(PLAN)) {
      const exist = await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = $1 and column_name = any($2::text[])`,
        [table, cols],
      );
      const present = exist.rows.map((r) => r.column_name);
      if (present.length === 0) continue;
      const set = present.map((c) => `${c} = ${c} + make_interval(days => $2)`).join(", ");
      const r = await client.query(`update public.${table} set ${set} where tenant_id = $1`, [tenantId, days]);
      console.log(`  ${table}: ${r.rowCount} satır (${present.join(", ")})`);
    }

    await client.query(apply ? "commit" : "rollback");
    console.log(apply ? "UYGULANDI." : "DRY-RUN: geri alındı (yazmak için --apply).");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
