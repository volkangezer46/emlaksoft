import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { insertNotifications, type NotificationRow } from "@/lib/notify-batch";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { resolvePriceHealth } from "@/lib/comparables";

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

/** features jsonb'den m² değeri — kanonik `sqm` + eski/alternatif anahtarlar. */
function sqmFromFeatures(features: Record<string, unknown> | null): number | null {
  if (!features) return null;
  for (const key of ["sqm", "net_sqm", "gross_sqm", "brut_m2", "net_m2"]) {
    const n = Number(features[key]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function relName(rel: { name?: string } | { name?: string }[] | null): string | null {
  const r = Array.isArray(rel) ? rel[0] : rel;
  return r?.name ?? null;
}

/** Tenant başına tek turda en fazla bu kadar portföy tazelenir (adil paylaşım). */
const HEALTH_PER_TENANT = 20;
/** Tur başına toplam üst sınır — cron süresi patlamasın. */
const HEALTH_TOTAL_LIMIT = 150;

/**
 * price_health boş/pending kalmış AKTİF portföyleri kalıcı olarak renklendirir.
 *
 * Kök neden: kolonu yalnız portföy create/update action'ları yazıyordu; seed,
 * import veya action öncesi kayıtlar süresiz "Fiyat bekliyor" kalıyordu.
 * Hesap resolvePriceHealth'te (önce emsal motoru, yetersizse m² modeli) —
 * action'la aynı karar noktası. Best-effort: hata teyit adımını bozmaz.
 */
async function refreshPriceHealth(admin: ReturnType<typeof createAdminClient>): Promise<number> {
  const { data: rows } = await admin
    .from("properties")
    .select(
      "id, tenant_id, list_price, transaction_type, property_type, district_id, features, district:geo_districts(name), province:geo_provinces(name)",
    )
    .in("status", ["live", "reserved"])
    .is("deleted_at", null)
    .or("price_health.is.null,price_health.eq.pending")
    .order("updated_at", { ascending: true })
    .limit(HEALTH_TOTAL_LIMIT);

  if (!rows?.length) return 0;

  const perTenant = new Map<string, number>();
  let updated = 0;
  for (const row of rows) {
    const tenantId = String(row.tenant_id);
    const used = perTenant.get(tenantId) ?? 0;
    if (used >= HEALTH_PER_TENANT) continue;
    perTenant.set(tenantId, used + 1);

    try {
      const health = await resolvePriceHealth(admin, {
        tenantId,
        listPrice: row.list_price != null ? Number(row.list_price) : null,
        sqm: sqmFromFeatures(row.features as Record<string, unknown> | null),
        districtId: row.district_id ? String(row.district_id) : null,
        propertyType: row.property_type,
        transactionType: row.transaction_type,
        districtHint:
          relName(row.district as { name?: string } | { name?: string }[] | null) ??
          relName(row.province as { name?: string } | { name?: string }[] | null),
        excludePropertyId: row.id,
      });
      // 'pending' tekrar yazılmaz: kolon null kalır, sonraki tur (m² gelince) yeniden dener.
      if (health === "pending") continue;
      const { error } = await admin
        .from("properties")
        .update({ price_health: health })
        .eq("id", row.id)
        .eq("tenant_id", tenantId);
      if (!error) updated += 1;
    } catch (e) {
      console.error("refreshPriceHealth", row.id, e);
    }
  }
  return updated;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const due = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: listings } = await admin
    .from("portal_listings")
    .select("id, tenant_id, portal_name, portal_listing_id, last_confirmed_at")
    .eq("status", "live")
    .or(`last_confirmed_at.is.null,last_confirmed_at.lt.${due}`)
    .limit(200);

  // Döngü içi insert yerine toplu yazma: 200 ilan için 200 gidiş-dönüş
  // yerine tek istek (500'lük parçalar hâlinde).
  const rows: NotificationRow[] = (listings ?? []).map((row) => ({
    tenant_id: String(row.tenant_id),
    title: "Portal teyit gecikti",
    body: `${row.portal_name}${row.portal_listing_id ? ` #${row.portal_listing_id}` : ""} — 7+ gündür teyit yok`,
    href: "/app/portallar",
    kind: "warning",
  }));

  const notified = await insertNotifications(admin, rows);

  // Ek adım: boş kalmış fiyat sağlıklarını doldur (best-effort, teyidi bozmaz).
  let priceHealthUpdated = 0;
  try {
    priceHealthUpdated = await refreshPriceHealth(admin);
  } catch (e) {
    console.error("portal-teyit refreshPriceHealth", e);
  }

  await recordHeartbeat("portal-teyit", "ok", `${notified} teyit uyarısı · ${priceHealthUpdated} fiyat sağlığı`);

  return NextResponse.json({ ok: true, notified, priceHealthUpdated });
}
