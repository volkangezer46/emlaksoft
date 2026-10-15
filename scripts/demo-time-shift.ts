/**
 * demo-ofis verisini "bugüne" kaydırır: canlı tablolardaki zaman damgaları TEK bir tam gün farkıyla ileri alınır
 * (kayıtlar arası sıra ve süreler korunur). Böylece demo girişinde bugünün randevuları, yeni talepler, bu ayın
 * ligi ve tazelik etiketleri dolu görünür.
 *
 * Fark (B081): kaydırılan TÜM tabloların "geçmiş" sütunlarındaki (oluşturma/güncelleme/tamamlama…) en yeni ŞİMDİYE
 * KADARKİ damgaya göre hesaplanır; en yeni kayıt dün olur. Eskiden yalnız müşterilerin en yenisine bakılıyordu,
 * müşterilerden daha yeni satırlar (sonraki seed'de eklenen portföyler, görevler, anlaşma güncellemeleri) geleceğe
 * taşınıyordu (17 Ara 2026 portföy, "son 4 hafta 61/61"). Geçmiş sütunlar ayrıca `least(sütun + fark, şimdi)` ile
 * sınırlanır: şimdiyi aşacak damga tavana çekilir (tavan: gece sıfırlama tabanı, yoksa şimdi; tabana çekilen satır
 * tohum sayılır, gece silinmez). Gelecek tarihli tohum satırı kalmaz; eski kaydırmanın bıraktıkları tek seferde
 * düzelir (fark 0 olsa da). Ziyaretçi kayıtları (taban ile şimdi arası) tavana çekilmez, gece yine silinir.
 * Randevu saati, görev vadesi, açık ev gibi İLERİ tarihli olabilen sütunlar yalnız kaydırılır (tavan yok).
 * Komisyon, kayıp-kaçak kapanışı, kasa hareketi ve hakediş de aynı farkla taşınır: komisyon anlaşmasından önceye
 * düşmez (eskiden PLAN'da yoktu, komisyon anlaşmadan 50 güne kadar önce görünüyordu).
 *
 * Gece sıfırlama tabanı (demo_reset_state.baseline_at) aynı işlemde aynı farkla ileri alınır; kaydırılan tohum
 * satırları gece sıfırlamasında "ziyaretçi kaydı" sayılıp silinmez. Tavan tabanı geçmediği için düzeltilen satırlar
 * da tohum sayılır.
 *
 * Güvenlik: yalnız `tenants.slug = 'demo-ofis'`; varsayılan DRY-RUN (transaction geri alınır), yazmak için `--apply`.
 * Kullanım: npx tsx scripts/demo-time-shift.ts [--apply] [--days=N]  (--days: farkı elle ver; prova/test için)
 */
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local", quiet: true });

const apply = process.argv.includes("--apply");
const daysArg = process.argv.find((a) => a.startsWith("--days="));
const forcedDays = daysArg ? Number.parseInt(daysArg.slice("--days=".length), 10) : null;
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
  deals: ["created_at", "updated_at", "title_deed_appointment_at"],
  notifications: ["created_at"],
  communications: ["created_at"],
  open_houses: ["starts_at", "ends_at", "created_at"],
  commissions: ["created_at"],
  listing_closures: ["created_at", "sla_warning_sent_at"],
  cash_entries: ["entry_date", "created_at", "reconciled_at", "voided_at"],
  commission_payouts: ["created_at", "updated_at", "approved_at", "paid_at"],
};

/** İleri tarihli olabilen sütunlar: yalnız kaydırılır, şimdiyle sınırlanmaz ve farkın hesabına girmez. */
const FUTURE_OK = new Set(["scheduled_at", "due_at", "starts_at", "ends_at", "title_deed_appointment_at", "entry_date"]);

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20_000 });

type Col = { name: string; type: string };

async function presentColumns(table: string, cols: string[]): Promise<Col[]> {
  const exist = await client.query<{ column_name: string; data_type: string }>(
    `select column_name, data_type from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = any($2::text[])`,
    [table, cols],
  );
  return exist.rows.map((r: { column_name: string; data_type: string }) => ({ name: r.column_name, type: r.data_type }));
}

async function main() {
  await client.connect();
  try {
    await client.query("begin");
    const t = await client.query<{ id: string }>("select id from public.tenants where slug = 'demo-ofis'");
    const tenantId = t.rows[0]?.id;
    if (!tenantId) throw new Error("demo-ofis bulunamadı");

    const columns = new Map<string, Col[]>();
    for (const [table, cols] of Object.entries(PLAN)) columns.set(table, await presentColumns(table, cols));

    // En yeni GEÇMİŞ damga (şimdiye kadar): tüm tabloların geçmiş sütunlarından. Gelecekteki (bozuk) damgalar sayılmaz,
    // aşağıdaki tavanla düzelir.
    const parts: string[] = [];
    for (const [table, cols] of columns) {
      for (const c of cols) {
        if (FUTURE_OK.has(c.name) || !c.type.startsWith("timestamp")) continue;
        parts.push(`select max(${c.name}) as m from public.${table} where tenant_id = $1 and ${c.name} <= now()`);
      }
    }
    const maxRes = await client.query<{ m: string | null }>(`select max(m) as m from (${parts.join(" union all ")}) x`, [tenantId]);
    const maxPast = maxRes.rows[0]?.m ?? null;
    const d = await client.query<{ days: number | null }>(
      `select floor(extract(epoch from (now() - interval '1 day' - $1::timestamptz)) / 86400)::int as days`,
      [maxPast],
    );
    const computed = Math.max(0, d.rows[0]?.days ?? 0);
    const days = forcedDays !== null && Number.isFinite(forcedDays) ? Math.max(0, forcedDays) : computed;
    console.log(`en yeni geçmiş damga: ${maxPast ?? "yok"} · kaydırma: ${days} gün${forcedDays !== null ? " (elle)" : ""}`);

    // Tavan: şimdi; gece sıfırlama tabanı varsa (aynı farkla ilerletilmiş) taban — tavana çekilen satır tohum sayılır.
    const reg = await client.query<{ ok: boolean }>("select to_regclass('public.demo_reset_state') is not null as ok");
    const hasReset = Boolean(reg.rows[0]?.ok);
    let cap = "now()";
    if (hasReset) {
      const b = await client.query(
        `update public.demo_reset_state set baseline_at = least(baseline_at + make_interval(days => $2), now()) where tenant_id = $1`,
        [tenantId, days],
      );
      console.log(`  demo_reset_state: taban ${days} gün ileri alındı (${b.rowCount} satır, en çok şimdi)`);
      cap = `least(now(), coalesce((select s.baseline_at from public.demo_reset_state s where s.tenant_id = $1), now()))`;
    } else {
      console.log("  demo_reset_state yok: gece sıfırlaması kurulu değil, taban güncellenmedi");
    }

    let touched = 0;
    for (const [table, cols] of columns) {
      if (cols.length === 0) continue;
      const set = cols
        .map((c) => {
          if (c.type === "date") return `${c.name} = ${c.name} + $2::int`;
          if (FUTURE_OK.has(c.name)) return `${c.name} = ${c.name} + make_interval(days => $2)`;
          // least(sütun + fark, şimdi) — tavanı aşan (gelecek) damga tohum-güvenli tavana çekilir.
          return `${c.name} = case when ${c.name} + make_interval(days => $2) > now() then ${cap} else ${c.name} + make_interval(days => $2) end`;
        })
        .join(", ");
      // Fark 0 ise yalnız tavanı aşan (gelecek tarihli) satırlar düzeltilir.
      const pastCols = cols.filter((c) => !FUTURE_OK.has(c.name) && c.type.startsWith("timestamp")).map((c) => c.name);
      const where =
        days > 0
          ? "tenant_id = $1"
          : pastCols.length > 0
            ? `tenant_id = $1 and (${pastCols.map((c) => `${c} > now()`).join(" or ")})`
            : null;
      if (!where) continue;
      const r = await client.query(`update public.${table} set ${set} where ${where}`, [tenantId, days]);
      touched += r.rowCount ?? 0;
      console.log(`  ${table}: ${r.rowCount} satır (${cols.map((c) => c.name).join(", ")})`);
    }

    // Son koşul: kaydırılan tablolarda gelecek tarihli geçmiş damga kalmadı.
    const leftParts: string[] = [];
    for (const [table, cols] of columns) {
      for (const c of cols) {
        if (FUTURE_OK.has(c.name) || !c.type.startsWith("timestamp")) continue;
        leftParts.push(`select count(*)::int as n from public.${table} where tenant_id = $1 and ${c.name} > now()`);
      }
    }
    const left = await client.query<{ n: number }>(`select sum(n)::int as n from (${leftParts.join(" union all ")}) x`, [tenantId]);
    if ((left.rows[0]?.n ?? 0) > 0) throw new Error(`gelecek tarihli damga kaldı: ${left.rows[0]?.n}`);
    console.log(`toplam ${touched} satır · gelecek tarihli damga: 0`);

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
