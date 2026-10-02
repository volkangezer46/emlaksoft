/**
 * Core workflow cut-over öncesi YALNIZ demo-ofis tenant'ının tarihsel
 * sapmalarını giderir (docs/runbooks/CORE_WORKFLOW_RECONCILIATION.md).
 *
 * Kapsam ve güvenlik:
 * - Tüm okuma/yazma `tenant_id = demo-ofis` ile sınırlıdır; gerçek tenant'lara dokunmaz.
 * - Varsayılan DRY-RUN: tek transaction içinde çalışır ve her zaman ROLLBACK eder.
 *   Yazmak için `--apply` gerekir; apply'da bile onarım sonrası blocker kalırsa ROLLBACK.
 * - Tutar/oran uydurulmaz: komisyon, uygulamanın kazanma akışıyla aynı matematikle
 *   (calculateCommission/buildSplits) ve kayıtlı portföy oranından üretilir. Proje
 *   dairesi satışında oran tanımlı olmadığı için uygulama varsayılan oranı kullanılır
 *   (demo veri; gerçek müşteri verisi için bu runbook adımı insan onayı ister).
 * - Çıktıda yalnız sayaç ve kısaltılmış (8 hane) demo kayıt kimliği basılır.
 *
 * Kullanım: npx tsx scripts/repair-demo-core-workflow.ts [--apply]
 */
import dotenv from "dotenv";
import pg from "pg";
import { buildSplits, calculateCommission } from "../src/lib/commission";
import { wonDealPropertyStatus } from "../src/lib/deal-outcome";
import {
  CORE_WORKFLOW_PREFLIGHT_SQL,
  CORE_WORKFLOW_BLOCKER_KEYS,
  formatCoreWorkflowCounts,
  type CoreWorkflowPreflightRow,
} from "../src/lib/core-workflow-preflight";
import { buildMissingWonCommissionRows } from "../src/lib/demo-seed-invariants";

dotenv.config({ path: ".env.local", quiet: true });

const DEMO_SLUG = "demo-ofis";
const apply = process.argv.includes("--apply");
const short = (id: string) => id.slice(0, 8);

const databaseUrl = process.env.DATABASE_POOLER_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_POOLER_URL veya DATABASE_URL gerekli");

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20_000,
});

type DealRow = {
  id: string;
  stage: string | null;
  deal_value: string | null;
  deal_type: string | null;
  property_id: string | null;
  project_unit_id: string | null;
  customer_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};
type PropertyRow = { id: string; status: string | null; list_price: string | null; commission_rate: string | null };

async function insertCommission(
  tenantId: string,
  row: { deal_id: string; gross_amount: number; vat_amount: number; status: string; splits: unknown; created_at?: string },
) {
  await client.query(
    `insert into public.commissions (tenant_id, deal_id, gross_amount, vat_amount, status, splits, created_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, coalesce($7::timestamptz, now()))`,
    [tenantId, row.deal_id, row.gross_amount, row.vat_amount, row.status, JSON.stringify(row.splits), row.created_at ?? null],
  );
}

async function main() {
  await client.connect();
  try {
    await client.query("begin");
    const tenant = await client.query<{ id: string }>("select id from public.tenants where slug = $1", [DEMO_SLUG]);
    const tenantId = tenant.rows[0]?.id;
    if (!tenantId) throw new Error(`${DEMO_SLUG} tenant'ı bulunamadı`);

    const before = (await client.query<CoreWorkflowPreflightRow>(CORE_WORKFLOW_PREFLIGHT_SQL)).rows[0] ?? {};
    console.log(`ÖNCE : ${formatCoreWorkflowCounts(before)}`);

    // 1) Aktif kiralamalar → tek won rent deal ile bağla (yoksa kiracı/portföy/kira bedeliyle oluştur).
    const rentals = await client.query<{
      id: string; property_id: string; renter_customer_id: string; monthly_rent: string;
      deal_id: string | null; prev_property_status: string | null; created_at: string;
    }>(
      `select id, property_id, renter_customer_id, monthly_rent, deal_id, prev_property_status, created_at
         from public.rentals where tenant_id = $1 and status = 'active' for update`,
      [tenantId],
    );
    for (const rental of rentals.rows) {
      const matches = await client.query<{ id: string }>(
        `select id from public.deals where tenant_id = $1 and stage = 'won' and deal_type = 'rent'
           and property_id = $2 and customer_id = $3`,
        [tenantId, rental.property_id, rental.renter_customer_id],
      );
      if (matches.rowCount && matches.rowCount > 1) throw new Error(`Kiralama ${short(rental.id)} için birden çok won rent deal var; elle incele`);
      let dealId = matches.rows[0]?.id;
      if (!dealId) {
        // Aktif kiralaması olan portföyde kazanılmış bir SATIŞ anlaşması çelişkidir (demo seed hatası):
        // runbook "yanlış won aşamasını düzelt" seçeneğine göre bu anlaşma müzakereye geri alınır.
        // Satış dışı ya da başka türde çelişki tahmin edilmez; elle incelenir.
        const conflicting = await client.query<{ id: string; deal_type: string }>(
          `select id, deal_type from public.deals where tenant_id = $1 and stage = 'won' and property_id = $2 for update`,
          [tenantId, rental.property_id],
        );
        for (const other of conflicting.rows) {
          if (other.deal_type !== "sale") {
            throw new Error(`Kiralama ${short(rental.id)}: portföyde satış dışı won anlaşma var; elle incele`);
          }
          await client.query(
            `update public.deals set stage = 'negotiation', updated_at = now() where id = $1 and tenant_id = $2`,
            [other.id, tenantId],
          );
          console.log(`  ~ anlaşma ${short(other.id)}: kiralık portföye bağlı yanlış won satış → negotiation`);
        }
        const created = await client.query<{ id: string }>(
          `insert into public.deals (tenant_id, property_id, customer_id, deal_type, stage, deal_value, probability,
                                     prev_property_status, is_sample, created_at, updated_at)
           values ($1, $2, $3, 'rent', 'won', $4, 100, 'live', true, $5, $5) returning id`,
          [tenantId, rental.property_id, rental.renter_customer_id, rental.monthly_rent, rental.created_at],
        );
        dealId = created.rows[0]!.id;
        console.log(`  + kiralama ${short(rental.id)} için won rent deal oluşturuldu (${short(dealId)})`);
      }
      const prev = !rental.prev_property_status || ["sold", "rented"].includes(rental.prev_property_status)
        ? "live" : rental.prev_property_status;
      await client.query(
        `update public.rentals set deal_id = $2, prev_property_status = $3 where id = $1 and tenant_id = $4`,
        [rental.id, dealId, prev, tenantId],
      );
    }

    // 2) Kazanılmış portföy anlaşmaları: portföy durumunu hizala, eksik komisyonu üret.
    const wonDeals = (await client.query<DealRow>(
      `select id, stage, deal_value, deal_type, property_id, project_unit_id, customer_id,
              created_at::text, updated_at::text
         from public.deals where tenant_id = $1 and stage = 'won' for update`,
      [tenantId],
    )).rows;
    const propertyIds = [...new Set(wonDeals.map((d) => d.property_id).filter((id): id is string => Boolean(id)))];
    const properties = (await client.query<PropertyRow>(
      `select id, status, list_price, commission_rate from public.properties
        where tenant_id = $1 and id = any($2::uuid[]) for update`,
      [tenantId, propertyIds],
    )).rows;
    const statusById = new Map(properties.map((p) => [p.id, p.status]));
    for (const deal of wonDeals) {
      if (!deal.property_id) continue;
      const expected = wonDealPropertyStatus(deal.deal_type);
      if (statusById.get(deal.property_id) !== expected) {
        await client.query(`update public.properties set status = $2 where id = $1 and tenant_id = $3`, [deal.property_id, expected, tenantId]);
        statusById.set(deal.property_id, expected);
        console.log(`  ~ portföy ${short(deal.property_id)} → ${expected} (anlaşma ${short(deal.id)})`);
      }
    }
    const existing = new Set((await client.query<{ deal_id: string }>(
      `select deal_id from public.commissions where tenant_id = $1`, [tenantId],
    )).rows.map((r) => r.deal_id));
    const missing = buildMissingWonCommissionRows({
      tenantId,
      deals: wonDeals,
      properties: properties.map((p) => ({ ...p, status: statusById.get(p.id) ?? p.status })),
      existingCommissionDealIds: existing,
    });
    for (const row of missing) {
      await insertCommission(tenantId, row);
      console.log(`  + komisyon (anlaşma ${short(row.deal_id)})`);
    }

    // 3) Satılmış proje daireleri → tek won sale deal + komisyon.
    const units = await client.query<{
      id: string; customer_id: string | null; list_price: string | null; sold_at: string | null;
    }>(
      `select id, customer_id, list_price, sold_at::text from public.project_units
        where tenant_id = $1 and status = 'sold' for update`,
      [tenantId],
    );
    for (const unit of units.rows) {
      const wonForUnit = await client.query<{ id: string }>(
        `select id from public.deals where tenant_id = $1 and project_unit_id = $2 and stage = 'won'`,
        [tenantId, unit.id],
      );
      if (wonForUnit.rowCount) continue;
      if (!unit.customer_id || !unit.list_price || !unit.sold_at) {
        throw new Error(`Daire ${short(unit.id)}: müşteri/fiyat/satış tarihi eksik; uydurulmaz, elle incele`);
      }
      const created = await client.query<{ id: string }>(
        `insert into public.deals (tenant_id, project_unit_id, customer_id, deal_type, stage, deal_value, probability,
                                   is_sample, created_at, updated_at)
         values ($1, $2, $3, 'sale', 'won', $4, 100, true, $5::timestamptz, $5::timestamptz) returning id`,
        [tenantId, unit.id, unit.customer_id, unit.list_price, unit.sold_at],
      );
      const dealId = created.rows[0]!.id;
      const calculated = calculateCommission({ amount: Number(unit.list_price) });
      await insertCommission(tenantId, {
        deal_id: dealId,
        gross_amount: calculated.net,
        vat_amount: calculated.vat,
        status: "paid",
        splits: buildSplits(calculated.net),
        created_at: unit.sold_at,
      });
      console.log(`  + daire ${short(unit.id)}: won sale deal ${short(dealId)} + komisyon`);
    }

    // 4) Teklif projeksiyonu: son tur alıcıda ise canonical durum 'submitted' (karşı teklif aktif değil).
    const offers = await client.query<{ id: string; amount: string; round_amount: string }>(
      `select o.id, o.amount, lr.amount as round_amount
         from public.offers o
         join lateral (select side, amount from public.offer_rounds r where r.offer_id = o.id order by round_no desc limit 1) lr on true
        where o.tenant_id = $1 and o.status = 'countered' and lr.side = 'buyer' for update of o`,
      [tenantId],
    );
    for (const offer of offers.rows) {
      if (Number(offer.amount) !== Number(offer.round_amount)) {
        throw new Error(`Teklif ${short(offer.id)}: tutar son turla uyuşmuyor; elle incele`);
      }
      await client.query(`update public.offers set status = 'submitted', counter_amount = null where id = $1 and tenant_id = $2`, [offer.id, tenantId]);
      console.log(`  ~ teklif ${short(offer.id)} → submitted (son tur alıcı)`);
    }

    // 5) Won olmayan anlaşmaya bağlı demo komisyonu: anlaşma kazanılmadığı için komisyon geçersiz → sil.
    const orphan = await client.query<{ id: string }>(
      `delete from public.commissions c using public.deals d
        where c.tenant_id = $1 and d.id = c.deal_id and d.tenant_id = c.tenant_id and d.stage <> 'won'
        returning c.id`,
      [tenantId],
    );
    for (const row of orphan.rows) console.log(`  - won olmayan anlaşmaya bağlı demo komisyonu silindi (${short(row.id)})`);

    const after = (await client.query<CoreWorkflowPreflightRow>(CORE_WORKFLOW_PREFLIGHT_SQL)).rows[0] ?? {};
    console.log(`SONRA: ${formatCoreWorkflowCounts(after)}`);
    const remaining = CORE_WORKFLOW_BLOCKER_KEYS.filter((key) => Number(after[key] ?? 0) > 0);
    if (remaining.length > 0) {
      await client.query("rollback");
      throw new Error(`Blocker kaldı (${remaining.join(", ")}); işlem GERİ ALINDI, hiçbir şey yazılmadı.`);
    }
    if (!apply) {
      await client.query("rollback");
      console.log("DRY-RUN: tüm blocker'lar sıfırlandı; işlem geri alındı. Yazmak için --apply ekle.");
      return;
    }
    await client.query("commit");
    console.log("APPLY: demo-ofis onarımı commit edildi.");
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
