import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyTenant } from "@/lib/notify";
import { OPEN_DEMAND_STATUSES } from "@/lib/workflow-state";
import { networkMatchScore, type MatchDemand, type MatchListing } from "@/lib/network/match";

/**
 * Ağa yeni ilan açılınca (OA10) DİĞER ofislerin açık taleplerinden uyanların sorumlu danışmanına tek bildirim.
 *
 * Sınır (network-boundary ile aynı ilke): okuma service_role ile yapılır ama
 *  - yalnız ağa katılan ofisler (en az bir ağ ilanı ya da ağ talebi açmış) bildirim alır;
 *  - bildirime giden metin ağ havuzunda ZATEN görünen maskeli özettir (ilçe · işlem · tür · oda · fiyat · paylaşım);
 *    paylaşan ofise karşı ofisin talebi hakkında HİÇBİR bilgi dönmez (yalnız sayı loglanmaz bile);
 *  - talep sahibi müşterinin adı/telefonu okunmaz; bildirim alıcının kendi talebine bağlantı verir.
 * Tavanlar: 300 aday talep, 25 alıcı; aynı ilan + aynı danışman için tek bildirim (dedupe).
 */
const CANDIDATE_CAP = 300;
const RECIPIENT_CAP = 25;

type Row = Record<string, unknown>;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const str = (v: unknown) => (typeof v === "string" ? v : null);

function priceShort(v: number | null): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  if (v >= 1_000_000) return `₺${(v / 1_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}M`;
  return `₺${Math.round(v).toLocaleString("tr-TR")}`;
}

export async function notifyNetworkListingMatches(listingId: string): Promise<{ notified: number }> {
  const admin = createAdminClient();
  const { data: listing } = await admin
    .from("network_listings")
    .select(
      `id, tenant_id, status, commission_share_pct,
       property:properties!inner(transaction_type, property_type, features, list_price, province_id, district_id, deleted_at,
         province:geo_provinces(name), district:geo_districts(name))`,
    )
    .eq("id", listingId)
    .maybeSingle();
  const prop = one((listing as Row | null)?.property as Row | Row[] | null);
  if (!listing || listing.status !== "active" || !prop || prop.deleted_at) return { notified: 0 };
  const ownerTenant = String(listing.tenant_id);
  const features = (prop.features ?? {}) as { rooms?: unknown };
  const item: MatchListing = {
    transactionType: str(prop.transaction_type),
    propertyType: str(prop.property_type),
    rooms: typeof features.rooms === "string" && features.rooms ? features.rooms : null,
    provinceName: str(one(prop.province as Row | Row[] | null)?.name),
    districtName: str(one(prop.district as Row | Row[] | null)?.name),
    price: typeof prop.list_price === "number" ? prop.list_price : null,
  };
  if (!prop.province_id) return { notified: 0 };

  // Aday talepler: aynı il, açık durum, diğer ofisler. İnce eleme (ilçe/oda/bütçe) saf eşleştiricide.
  const { data: demands } = await admin
    .from("customer_demands")
    .select(
      `id, tenant_id, transaction_type, property_type, rooms, budget_min, budget_max,
       province:geo_provinces(name), district:geo_districts(name),
       customer:customers!customer_demands_customer_id_fkey!inner(assigned_to, deleted_at, is_sample)`,
    )
    .eq("province_id", String(prop.province_id))
    .neq("tenant_id", ownerTenant)
    .in("status", [...OPEN_DEMAND_STATUSES])
    .order("created_at", { ascending: false })
    .limit(CANDIDATE_CAP);
  const rows = (demands ?? []) as Row[];
  if (rows.length === 0) return { notified: 0 };

  // Yalnız ağa katılan ofisler.
  const tenantIds = [...new Set(rows.map((r) => String(r.tenant_id)))];
  const [{ data: l }, { data: d }] = await Promise.all([
    admin.from("network_listings").select("tenant_id").in("tenant_id", tenantIds).limit(1000),
    admin.from("network_demands").select("tenant_id").in("tenant_id", tenantIds).limit(1000),
  ]);
  const participants = new Set([...(l ?? []), ...(d ?? [])].map((r) => String((r as Row).tenant_id)));

  const byRecipient = new Map<string, { tenantId: string; demandId: string }>();
  for (const r of rows) {
    const tenantId = String(r.tenant_id);
    if (!participants.has(tenantId)) continue;
    const customer = one(r.customer as Row | Row[] | null);
    const advisor = str(customer?.assigned_to);
    if (!advisor || customer?.deleted_at || customer?.is_sample === true) continue;
    const demand: MatchDemand = {
      transactionType: str(r.transaction_type),
      propertyType: str(r.property_type),
      rooms: str(r.rooms),
      provinceName: str(one(r.province as Row | Row[] | null)?.name),
      districtName: str(one(r.district as Row | Row[] | null)?.name),
      budgetMin: typeof r.budget_min === "number" ? r.budget_min : null,
      budgetMax: typeof r.budget_max === "number" ? r.budget_max : null,
    };
    if (networkMatchScore(demand, item) === null) continue;
    if (!byRecipient.has(advisor)) byRecipient.set(advisor, { tenantId, demandId: String(r.id) });
    if (byRecipient.size >= RECIPIENT_CAP) break;
  }

  const summary = [item.districtName ?? item.provinceName, [item.transactionType, item.propertyType].filter(Boolean).join(" "), item.rooms, priceShort(item.price)]
    .filter(Boolean)
    .join(" · ");
  let notified = 0;
  for (const [userId, target] of byRecipient) {
    try {
      await notifyTenant({
        tenantId: target.tenantId,
        userId,
        title: "Ağda talebinize uyan yeni ilan",
        body: `${summary} · %${Number(listing.commission_share_pct)} komisyon paylaşımı`,
        href: `/app/ag?sekme=havuz&talep=${target.demandId}`,
        kind: "info",
        dedupeKey: `net-match:${listingId}:${userId}`,
      });
      notified += 1;
    } catch (e) {
      console.error("notifyNetworkListingMatches", e instanceof Error ? e.message : e);
    }
  }
  return { notified };
}
