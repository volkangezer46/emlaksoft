/**
 * demo-ofis'in "bu ay" ekranlarının boş görünmemesi için son etkinlikleri günceller:
 *  - en yeni 3 komisyonun tarihini son güne/ikiye çeker (bu ay içinde kalır) (Komisyon / Raporlar "dönem" KPI'ları dolar),
 *  - ilgili kazanılmış anlaşmaların updated_at'ini aynı güne hizalar,
 *  - kayıp-kaçak için bu aya iki rakip-kapanış kaydı ekler (yalnızca yoksa).
 *
 * Güvenlik: yalnız `tenant_id = demo-ofis`; varsayılan DRY-RUN (transaction geri alınır),
 * yazmak için `--apply`. Gerçek tenant'lara dokunmaz. Tutarlar demo verisi içindir.
 *
 * Kullanım: npx tsx scripts/refresh-demo-activity.ts [--apply]
 */
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local", quiet: true });

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_POOLER_URL || process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_POOLER_URL veya DATABASE_URL gerekli");

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20_000 });

async function main() {
  await client.connect();
  try {
    await client.query("begin");
    const tenant = await client.query<{ id: string }>("select id from public.tenants where slug = 'demo-ofis'");
    const tenantId = tenant.rows[0]?.id;
    if (!tenantId) throw new Error("demo-ofis bulunamadı");

    const kpi = async (label: string) => {
      const r = await client.query(
        `select
           coalesce(sum(gross_amount) filter (where created_at >= date_trunc('month', now())), 0)::numeric as bu_ay_komisyon,
           (select count(*) from public.listing_closures where tenant_id = $1 and created_at >= date_trunc('month', now()))::int as bu_ay_kapanis
         from public.commissions where tenant_id = $1`,
        [tenantId],
      );
      console.log(`${label}:`, JSON.stringify(r.rows[0]));
    };
    await kpi("ÖNCE ");

    // 1) En yeni 3 komisyonu son 3 haftaya yay (2, 9, 16 gün önce); bağlı kazanılmış anlaşmayı hizala.
    const newest = await client.query<{ id: string; deal_id: string }>(
      `select id, deal_id from public.commissions where tenant_id = $1 order by created_at desc limit 3 for update`,
      [tenantId],
    );
    // Saat cinsinden: ayın ilk günlerinde de "bu ay" içinde kalsın.
    const offsets = [1, 8, 30];
    for (const [i, row] of newest.rows.entries()) {
      await client.query(
        `update public.commissions set created_at = now() - make_interval(hours => $2) where id = $1 and tenant_id = $3`,
        [row.id, offsets[i], tenantId],
      );
      await client.query(
        `update public.deals set updated_at = now() - make_interval(hours => $2) where id = $1 and tenant_id = $3 and stage = 'won'`,
        [row.deal_id, offsets[i], tenantId],
      );
    }
    console.log(`  ~ ${newest.rowCount} komisyon ve bağlı anlaşma tarihi güncellendi`);

    // 2) Bu ay için iki rakip-kapanış (yalnız bu ay hiç kayıt yoksa).
    const existing = await client.query(
      `select 1 from public.listing_closures where tenant_id = $1 and created_at >= date_trunc('month', now())`,
      [tenantId],
    );
    if (!existing.rowCount) {
      const listings = await client.query<{ id: string }>(
        `select id from public.portal_listings where tenant_id = $1 and status <> 'removed' order by created_at desc limit 2`,
        [tenantId],
      );
      const samples = [
        { hours: 5, reason: "Rakip ofis aynı portföyü kapattı", amount: 8_400_000, lost: 168_000 },
        { hours: 28, reason: "Müşteri başka ofisle anlaştı", amount: 5_200_000, lost: 104_000 },
      ];
      for (const [i, l] of listings.rows.entries()) {
        const s = samples[i]!;
        await client.query(
          `insert into public.listing_closures
             (tenant_id, portal_listing_id, reason, deal_happened, deal_amount, closed_by_us, competitor_closed,
              estimated_lost_commission, created_at)
           values ($1, $2, $3, true, $4, false, true, $5, now() - make_interval(hours => $6))`,
          [tenantId, l.id, s.reason, s.amount, s.lost, s.hours],
        );
        console.log(`  + kayıp-kaçak kaydı (${s.hours} saat önce, tahmini kayıp ${s.lost})`);
      }
    } else {
      console.log("  = bu ay için kapanış kaydı zaten var, eklenmedi");
    }

    await kpi("SONRA");
    if (!apply) {
      await client.query("rollback");
      console.log("DRY-RUN: geri alındı. Yazmak için --apply ekle.");
      return;
    }
    await client.query("commit");
    console.log("APPLY: commit edildi.");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
