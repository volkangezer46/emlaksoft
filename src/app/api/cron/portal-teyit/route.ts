import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findRecentKeysByPrefix, insertNotificationsDetailed, type NotificationRow } from "@/lib/notify-batch";
import { fetchAllPaged, heartbeatFor } from "@/lib/cron-run";
import { buildDedupeKey, timeBucket } from "@/lib/notify-dedupe";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { getDisabledModulesByTenant, isDisabledFor, skippedTenantsNote } from "@/lib/modules/state";
import { resolvePriceHealth } from "@/lib/comparables";
import { authorizeCron } from "@/lib/cron-auth";
import { runControlStepBroad } from "@/lib/listing-control/server/cron-steps";

/** Toplu işlem + fiyat sağlığı adımı: varsayılan süre yetmeyebilir. */
export const maxDuration = 300;

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
      const feat = row.features as Record<string, unknown> | null;
      const health = await resolvePriceHealth(admin, {
        tenantId,
        listPrice: row.list_price != null ? Number(row.list_price) : null,
        sqm: sqmFromFeatures(feat),
        districtId: row.district_id ? String(row.district_id) : null,
        propertyType: row.property_type,
        transactionType: row.transaction_type,
        districtHint:
          relName(row.district as { name?: string } | { name?: string }[] | null) ??
          relName(row.province as { name?: string } | { name?: string }[] | null),
        excludePropertyId: row.id,
        targetFloor: feat?.floor != null ? Number(feat.floor) : null,
        targetBuildingAge: feat?.building_age != null ? Number(feat.building_age) : null,
        targetHeating: (feat?.heating as string | undefined) ?? null,
        targetFacade: (feat?.facade as string | undefined) ?? null,
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

/** Son `sinceIso`'dan beri `portal_listing_health.last_success_at` kaydı olan ilanlar. Tablo yoksa/hata olursa boş küme. */
async function recentlyVerifiedListingIds(
  admin: ReturnType<typeof createAdminClient>,
  ids: string[],
  sinceIso: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin
      .from("portal_listing_health")
      .select("portal_listing_id")
      .in("portal_listing_id", ids.slice(i, i + 200))
      .gte("last_success_at", sinceIso);
    if (error) return out; // şema yok ya da okuma hatası: eski davranışa düş (uyarı üret)
    for (const r of (data ?? []) as { portal_listing_id: string }[]) out.add(r.portal_listing_id);
  }
  return out;
}

export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  const admin = createAdminClient();
  const startedAt = Date.now();
  const due = new Date(startedAt - 7 * 86_400_000).toISOString();
  // Sırasız .limit(200) kaldırıldı: order(id) + range sayfalama.
  const { rows: listings, error: listError } = await fetchAllPaged<{
    id: string;
    tenant_id: string;
    portal_name: string | null;
    portal_listing_id: string | null;
  }>(
    (from, to) =>
      admin
        .from("portal_listings")
        .select("id, tenant_id, portal_name, portal_listing_id, last_confirmed_at")
        .eq("status", "live")
        .or(`last_confirmed_at.is.null,last_confirmed_at.lt.${due}`)
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: { id: string; tenant_id: string; portal_name: string | null; portal_listing_id: string | null }[] | null;
        error: { message: string } | null;
      }>,
  );

  // Döngü içi insert yerine toplu yazma (500'lük parçalar hâlinde).
  // Modül kapısı: "Portal Kontrol" kapalı ofislere teyit uyarısı yazılmaz (fiyat sağlığı adımı etkilenmez).
  const disabledModules = await getDisabledModulesByTenant(admin);
  // Çoğaltma yok: ilan kontrol sistemi (portal_listing_health) son 7 günde başarılı kontrol kaydettiyse "teyit gecikti"
  // uyarısı yazılmaz; yalnız gerçekten kontrolsüz kalanlar bildirilir. Tablo yoksa eski davranış (hepsi).
  const recentlyVerified = await recentlyVerifiedListingIds(admin, listings.map((l) => String(l.id)), due);
  const eligible = listings.filter(
    (row) => !isDisabledFor(disabledModules, String(row.tenant_id), "portals") && !recentlyVerified.has(String(row.id)),
  );

  // Tekrar önleme: ilan başına 24 saatte en fazla 1 bildirim (cron 6 saatte bir çalışır).
  // dedupe_key kolonu yoksa (migration uygulanmamış) `recent` null → eski davranış (dedupe yok).
  const dedupeWindowMs = 24 * 3_600_000;
  const recent = await findRecentKeysByPrefix(admin, {
    tenantIds: [...new Set(eligible.map((r) => String(r.tenant_id)))],
    prefix: "portal-teyit:",
    sinceIso: new Date(startedAt - dedupeWindowMs).toISOString(),
  });
  const bucket = timeBucket(startedAt, dedupeWindowMs);
  const listingPrefix = (id: string) => buildDedupeKey("portal-teyit", id);
  const recentListings = new Set<string>();
  for (const k of recent ?? []) {
    // "portal-teyit:<ilan>:<kova>" → "portal-teyit:<ilan>"
    recentListings.add(k.slice(0, k.lastIndexOf(":")));
  }
  let skippedRecent = 0;
  const rows: NotificationRow[] = [];
  for (const row of eligible) {
    if (recent && recentListings.has(listingPrefix(String(row.id)))) {
      skippedRecent += 1;
      continue;
    }
    rows.push({
      tenant_id: String(row.tenant_id),
      title: "Portal teyit gecikti",
      body: `${row.portal_name}${row.portal_listing_id ? ` #${row.portal_listing_id}` : ""} — 7+ gündür teyit yok`,
      href: "/app/portallar",
      kind: "warning",
      dedupe_key: recent ? buildDedupeKey("portal-teyit", row.id, bucket) : null,
    });
  }

  const insertResult = await insertNotificationsDetailed(admin, rows);
  const notified = insertResult.written;

  // Ek adım: boş kalmış fiyat sağlıklarını doldur (best-effort, teyidi bozmaz).
  let priceHealthUpdated = 0;
  try {
    priceHealthUpdated = await refreshPriceHealth(admin);
  } catch (e) {
    console.error("portal-teyit refreshPriceHealth", e);
  }

  // Ek adım: kontrol işi planlama + lease hasadı (yeni cron yok; en iyi çaba, teyidi bozmaz).
  const control = await runControlStepBroad(admin);

  const hb = heartbeatFor({
    total: listings.length,
    processed: listings.length,
    failed: insertResult.failed,
    timedOut: false,
    listError,
    summary: `${notified} teyit uyarısı · ${skippedRecent + insertResult.duplicates} son 24 saatte bildirilmiş · ${recentlyVerified.size} kontrol sistemince doğrulanmış · ${priceHealthUpdated} fiyat sağlığı · ${control.text}${skippedTenantsNote(disabledModules, "portals")}`,
  });
  await recordHeartbeat("portal-teyit", hb.status, hb.detail);

  return NextResponse.json({ ok: hb.status === "ok", notified, skippedRecent, failed: insertResult.failed, priceHealthUpdated });
}
