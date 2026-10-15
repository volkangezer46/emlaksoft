import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findRecentKeysByPrefix, insertNotificationsDetailed, type NotificationRow } from "@/lib/notify-batch";
import { fetchAllPaged, heartbeatFor, guardCron } from "@/lib/cron-run";
import { buildDedupeKey, timeBucket } from "@/lib/notify-dedupe";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { readAllPaged } from "@/lib/supabase/read-all-paged";
import { getDisabledModulesByTenant, isDisabledFor, skippedTenantsNote, tenantsDisabledFor } from "@/lib/modules/state";
import { resolvePriceHealth } from "@/lib/comparables";
import { fetchLatestRates } from "@/lib/fx";
import { priceForHealth, propertyCurrency } from "@/lib/property-currency";
import { authorizeCron } from "@/lib/cron-auth";
import { beginCronRun } from "@/lib/cron-pause";
import { runControlStepBroad } from "@/lib/listing-control/server/cron-steps";
import { portalDisplayName } from "@/lib/portals/catalog";
import { WEEK_MS, isNonMemberListing, outOfMembershipText, planPortalTeyit, weeklySummaryText, type NonePortals, type TeyitListing } from "@/lib/portals/teyit-plan";
import { log } from "@/lib/log";
import { errorFields } from "@/lib/log-error";

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
      "id, tenant_id, list_price, currency, transaction_type, property_type, district_id, features, district:geo_districts(name), province:geo_provinces(name)",
    )
    .in("status", ["live", "reserved"])
    .is("deleted_at", null)
    .or("price_health.is.null,price_health.eq.pending")
    .order("updated_at", { ascending: true })
    .limit(HEALTH_TOTAL_LIMIT);

  if (!rows?.length) return 0;

  // Döviz fiyatlı portföy ₺ karşılığıyla değerlendirilir (B094); kur yoksa atlanır (kolon boş kalır, sahte "Riskli" yok).
  const rates = rows.some((r) => propertyCurrency(r) !== "TRY") ? await fetchLatestRates(admin) : null;
  const perTenant = new Map<string, number>();
  let updated = 0;
  for (const row of rows) {
    const tenantId = String(row.tenant_id);
    const used = perTenant.get(tenantId) ?? 0;
    if (used >= HEALTH_PER_TENANT) continue;
    perTenant.set(tenantId, used + 1);

    try {
      const feat = row.features as Record<string, unknown> | null;
      const priced = priceForHealth(row.list_price != null ? Number(row.list_price) : null, propertyCurrency(row), rates);
      if (priced.unrated) continue;
      const health = await resolvePriceHealth(admin, {
        tenantId,
        listPrice: priced.priceTry,
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
      log.error("portal_teyit_price_health_failed", { route: "/api/cron/portal-teyit", propertyId: row.id, ...errorFields(e) });
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

/** Üyelik girdileri için açık satır tavanı (sayfalı okuma; aşılırsa heartbeat'e "kısmi" notu düşer). */
const MEMBERSHIP_MAX_ROWS = 20_000;

/**
 * EP1 üyelik girdileri: üyeliği "none" olan portallar (ofis → portal) ve eklentisi (iptal edilmemiş verification_clients) olan
 * ofisler. Tablo yoksa/okunamazsa: none boş, eklenti kümesi null (eski davranış: ilan başına günlük uyarı).
 * `truncated`: satır tavanına ulaşan okumaların adları (liste TAM DEĞİL; heartbeat 'error' olur).
 */
async function loadMembershipInputs(
  admin: ReturnType<typeof createAdminClient>,
): Promise<{ nonePortals: NonePortals; withExtension: Set<string> | null; truncated: string[] }> {
  const nonePortals = new Map<string, Set<string>>();
  const [accounts, clients] = await Promise.all([
    readAllPaged<{ tenant_id: string; portal: string }>(
      (from, to) =>
        admin
          .from("tenant_portal_accounts")
          .select("tenant_id, portal")
          .eq("status", "none")
          .order("tenant_id", { ascending: true })
          .order("portal", { ascending: true })
          .range(from, to),
      { maxRows: MEMBERSHIP_MAX_ROWS },
    ),
    readAllPaged<{ id: string; tenant_id: string }>(
      (from, to) =>
        admin.from("verification_clients").select("id, tenant_id").is("revoked_at", null).order("id", { ascending: true }).range(from, to),
      { maxRows: MEMBERSHIP_MAX_ROWS },
    ),
  ]);
  if (!accounts.error) {
    for (const r of accounts.rows) {
      const set = nonePortals.get(r.tenant_id) ?? new Set<string>();
      set.add(r.portal);
      nonePortals.set(r.tenant_id, set);
    }
  }
  const withExtension = clients.error ? null : new Set(clients.rows.map((r) => String(r.tenant_id)));
  const truncated: string[] = [];
  if (accounts.truncated) truncated.push("portal üyelikleri");
  if (clients.truncated) truncated.push("eklenti istemcileri");
  return { nonePortals, withExtension, truncated };
}

/**
 * Üyeliği "none" olan portallardaki canlı ilanlar (tek seferlik uyarı için). portal_name birebir süzülmez: eski ya da
 * aktarım/eşleme yoluyla "Sahibinden" yazılmış satırlar da yakalansın diye eşleme bellekte (planPortalTeyit →
 * portalIdFromName) yapılır; burada yalnız ilgili ofislerin canlı ilanları okunur (sayfalı, açık tavanlı).
 */
async function loadNonMemberLive(
  admin: ReturnType<typeof createAdminClient>,
  none: NonePortals,
): Promise<{ rows: TeyitListing[]; truncated: boolean }> {
  if (none.size === 0) return { rows: [], truncated: false };
  const tenantIds = [...none.keys()];
  const res = await readAllPaged<TeyitListing>(
    (from, to) =>
      admin
        .from("portal_listings")
        .select("id, tenant_id, portal_name, portal_listing_id")
        .eq("status", "live")
        .in("tenant_id", tenantIds)
        .order("id", { ascending: true })
        .range(from, to),
    { maxRows: MEMBERSHIP_MAX_ROWS },
  );
  if (res.error) return { rows: [], truncated: false };
  return { rows: res.rows.filter((l) => isNonMemberListing(l, none)), truncated: res.truncated };
}

async function run(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const pausedRun = await beginCronRun("portal-teyit", req);
  if (pausedRun) return pausedRun;

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
  const eligibleRaw = listings.filter(
    (row) => !isDisabledFor(disabledModules, String(row.tenant_id), "portals") && !recentlyVerified.has(String(row.id)),
  );
  // EP1: üyelik süzgeci. "none" portaldaki ilan teyit uyarısı almaz (tek seferlik "üyelik dışı" uyarısı); eklentisi olmayan
  // ofise ilan başına günlük uyarı yerine haftalık tek özet gider.
  const membership = await loadMembershipInputs(admin);
  const nonMemberRead = await loadNonMemberLive(admin, membership.nonePortals);
  const nonMemberLive = nonMemberRead.rows.filter(
    (row) => !isDisabledFor(disabledModules, String(row.tenant_id), "portals"),
  );
  const plan = planPortalTeyit({
    overdue: eligibleRaw,
    nonMemberLive,
    nonePortals: membership.nonePortals,
    tenantsWithExtension: membership.withExtension,
  });
  const eligible = plan.daily;

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
      body: `${portalDisplayName(row.portal_name)}${row.portal_listing_id ? ` #${row.portal_listing_id}` : ""} — 7+ gündür teyit yok`,
      href: "/app/ilan-kontrol/portallar",
      kind: "warning",
      dedupe_key: recent ? buildDedupeKey("portal-teyit", row.id, bucket) : null,
    });
  }

  // Tek seferlik "üyelik dışı portalda canlı ilan" (kova yok: ilan başına bir kez) + haftalık "elle teyit edin" özeti.
  // Bu satırlar YALNIZ dedupe_key ile anlamlıdır (yoksa her turda tekrar eder): kolon yoksa (`recent` null ya da yoklama
  // null) hiç eklenmez; günlük uyarılar eski davranışla yazılmaya devam eder.
  const extraTenants = [...new Set([...plan.outOfMembership.map((l) => String(l.tenant_id)), ...plan.weekly.map((w) => w.tenantId)])];
  const dedupeReady =
    extraTenants.length > 0 &&
    (eligible.length > 0
      ? recent !== null
      : (await findRecentKeysByPrefix(admin, { tenantIds: extraTenants, prefix: "portal-teyit-ozet:", sinceIso: new Date(startedAt - WEEK_MS).toISOString() })) !== null);
  const weekBucket = timeBucket(startedAt, WEEK_MS);
  for (const l of dedupeReady ? plan.outOfMembership : []) {
    rows.push({
      tenant_id: String(l.tenant_id),
      ...outOfMembershipText(l),
      href: "/app/ilan-kontrol/portallar",
      kind: "warning",
      dedupe_key: buildDedupeKey("portal-uyelik-disi", l.id),
    });
  }
  for (const w of dedupeReady ? plan.weekly : []) {
    rows.push({
      tenant_id: w.tenantId,
      ...weeklySummaryText(w.count),
      href: "/app/ilan-kontrol/portallar",
      kind: "warning",
      dedupe_key: buildDedupeKey("portal-teyit-ozet", weekBucket),
    });
  }

  const insertResult = await insertNotificationsDetailed(admin, rows);
  const notified = insertResult.written;

  // Ek adım: boş kalmış fiyat sağlıklarını doldur (best-effort, teyidi bozmaz).
  let priceHealthUpdated = 0;
  try {
    priceHealthUpdated = await refreshPriceHealth(admin);
  } catch (e) {
    log.error("portal_teyit_price_health_refresh_failed", { route: "/api/cron/portal-teyit", ...errorFields(e) });
  }

  // Ek adım: kontrol işi planlama + lease hasadı (yeni cron yok; en iyi çaba, teyidi bozmaz).
  // Gece turunda kopya portföy taraması da burada yürür (portals modülü kapalı ofisler atlanır).
  const control = await runControlStepBroad(admin, { disabledTenantIds: new Set(tenantsDisabledFor(disabledModules, "portals")) });

  // Sayfalı okumada satır tavanına ulaşıldıysa liste TAM DEĞİL: sessizce "ok" sayılmaz.
  const truncatedReads = [...membership.truncated, ...(nonMemberRead.truncated ? ["üyelik dışı canlı ilanlar"] : [])];
  const truncatedNote = truncatedReads.length > 0 ? `kısmi okuma (satır tavanı ${MEMBERSHIP_MAX_ROWS}): ${truncatedReads.join(", ")}` : null;
  const hb = heartbeatFor({
    total: listings.length,
    processed: listings.length,
    failed: insertResult.failed,
    timedOut: false,
    listError: [listError, truncatedNote].filter(Boolean).join(" · ") || null,
    summary: `${notified} teyit uyarısı · ${plan.weekly.length} haftalık elle teyit özeti (eklentisiz ofis) · ${plan.outOfMembership.length} üyelik dışı canlı ilan · ${skippedRecent + insertResult.duplicates} daha önce bildirilmiş · ${recentlyVerified.size} kontrol sistemince doğrulanmış · ${priceHealthUpdated} fiyat sağlığı · ${control.text}${skippedTenantsNote(disabledModules, "portals")}${extraTenants.length > 0 && !dedupeReady ? " · özet ve üyelik dışı uyarıları atlandı (dedupe kolonu yok)" : ""}`,
  });
  await recordHeartbeat("portal-teyit", hb.status, hb.detail);

  return NextResponse.json({ ok: hb.status === "ok", notified, skippedRecent, failed: insertResult.failed, priceHealthUpdated });
}

export const GET = guardCron("portal-teyit", run);
