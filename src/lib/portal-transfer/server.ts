import type { SupabaseClient } from "@supabase/supabase-js";
import { featureFacts } from "@/lib/listing-control/duplicates";
import { INVENTORY_LIMITS, type PropertyForMatch } from "@/lib/listing-control/inventory-import";
import { normalizeExternalId } from "@/lib/listing-control/matching";
import type { PortalPropertyInput } from "./payload";
import type { BoundMap } from "./import-plan";
import type { TransferPortal } from "./rules";

/**
 * Aktarım SUNUCU okuyucuları. Yalnız KULLANICI OTURUMU istemcisiyle (RLS'li) çağrılır: çağıran `createClient()` verir,
 * service_role YOKTUR. Tablo/kolon eksikse (migration uygulanmamış) null/boş döner; üst katman "sistem güncellemesi bekleniyor" der.
 */

type Db = SupabaseClient;
type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const nameOf = (rel: unknown): string | null => {
  const r = Array.isArray(rel) ? rel[0] : rel;
  return str((r as { name?: unknown } | null)?.name);
};

/** Portföy + fotoğraf listesi + tapu durumu → aktarım girdisi. Silinmiş / başka ofis / görünmeyen portföy: null. */
export async function loadPropertyForTransfer(db: Db, tenantId: string, propertyId: string): Promise<PortalPropertyInput | null> {
  const [propRes, mediaRes, ownerRes] = await Promise.all([
    db
      .from("properties")
      .select("*, province:geo_provinces(name), district:geo_districts(name), neighborhood:geo_neighborhoods(name)")
      .eq("id", propertyId)
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .maybeSingle(),
    db.from("property_media").select("*").eq("property_id", propertyId).eq("tenant_id", tenantId).eq("kind", "image").order("sort_order", { ascending: true }).limit(200),
    db.from("property_owner_info").select("deed_status").eq("property_id", propertyId).eq("tenant_id", tenantId).maybeSingle(),
  ]);
  if (propRes.error || !propRes.data) return null;
  const p = propRes.data as Row;
  const media = ((mediaRes.data ?? []) as Row[]).filter((m) => m.is_document !== true);
  return {
    id: String(p.id),
    propertyCode: String(p.property_code ?? ""),
    title: str(p.title),
    transactionType: String(p.transaction_type ?? ""),
    propertyType: String(p.property_type ?? ""),
    listPrice: p.list_price === null || p.list_price === undefined ? null : Number(p.list_price),
    provinceName: nameOf(p.province),
    districtName: nameOf(p.district),
    neighborhoodName: nameOf(p.neighborhood),
    addressLine: str(p.address_line),
    features: (p.features && typeof p.features === "object" ? p.features : {}) as Record<string, unknown>,
    parcelBlock: str(p.parcel_block),
    parcelLot: str(p.parcel_lot),
    // Portföyde sütun yok; "Takasa uygun" `features.swap_ok` (evet/hayır) olarak tutulur. Girilmemişse boş kalır, uydurulmaz.
    swapOk: typeof (p.features as Record<string, unknown> | null)?.swap_ok === "boolean" ? ((p.features as Record<string, unknown>).swap_ok as boolean) : null,
    eidsPropertyNo: str(p.eids_property_no),
    authorityDocNo: str(p.authority_doc_no),
    authorityEidsStatus: str(p.authority_eids_status),
    authorizationStart: str(p.authorization_start),
    authorizationEnd: str(p.authorization_end),
    deedStatus: str((ownerRes.data as Row | null)?.deed_status),
    photos: media.map((m) => ({
      id: String(m.id),
      fileName: str(m.file_name),
      fileType: str(m.file_type),
      isCover: m.is_cover === true,
      sortOrder: Number(m.sort_order ?? 0),
    })),
  };
}

/**
 * Bu ofiste bu portalda CANLI olan ilan numaraları → portföy. Harita çağıranın RLS'li oturumundan kurulur (kiracı sınırı
 * veritabanında; başka ofisin ilan numarası görünmez).
 */
export async function loadBoundMap(db: Db, tenantId: string, portal: TransferPortal, externalIds: readonly string[]): Promise<BoundMap> {
  const norms = [...new Set(externalIds.map((x) => normalizeExternalId(x)).filter((x): x is string => !!x))];
  const map = new Map<string, { propertyId: string; propertyCode: string | null }>();
  if (norms.length === 0) return map;
  const { data, error } = await db
    .from("portal_listings")
    .select("property_id, external_id_norm, portal_name, property:properties!portal_listings_property_id_fkey(property_code)")
    .eq("tenant_id", tenantId)
    .eq("status", "live")
    .ilike("portal_name", portal)
    .in("external_id_norm", norms);
  if (error) return map;
  for (const r of (data ?? []) as Row[]) {
    const key = str(r.external_id_norm);
    if (!key) continue;
    map.set(key, { propertyId: String(r.property_id), propertyCode: str(((Array.isArray(r.property) ? r.property[0] : r.property) as Row | null)?.property_code) });
  }
  return map;
}

/** Eşleştirme havuzu: aktif portföyler (yönetim ofis geneli, diğerleri yalnız kendi portföyü). */
export async function loadMatchPool(db: Db, scope: "mine" | "office", userId: string): Promise<PropertyForMatch[]> {
  const out: PropertyForMatch[] = [];
  for (let from = 0; from < INVENTORY_LIMITS.maxRows; from += 1000) {
    let q = db
      .from("properties")
      .select("id, property_code, title, address_line, list_price, features, parcel_block, parcel_lot, lat, lng, district_id, assigned_to")
      .is("deleted_at", null)
      .not("is_sample", "is", true)
      .not("status", "in", "(sold,rented,withdrawn,passive,archived)")
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (scope === "mine") q = q.eq("assigned_to", userId);
    const { data, error } = await q;
    if (error) break;
    for (const r of (data ?? []) as Row[]) {
      const f = featureFacts(r.features as Record<string, unknown> | null);
      out.push({
        id: String(r.id),
        code: str(r.property_code),
        title: str(r.title),
        address: str(r.address_line),
        price: r.list_price === null || r.list_price === undefined ? null : Number(r.list_price),
        sqm: f.sqm,
        rooms: f.rooms,
        block: str(r.parcel_block),
        lot: str(r.parcel_lot),
        lat: typeof r.lat === "number" ? r.lat : null,
        lng: typeof r.lng === "number" ? r.lng : null,
        districtKey: str(r.district_id),
        advisorName: null,
      });
    }
    if ((data ?? []).length < 1000) break;
  }
  return out;
}
