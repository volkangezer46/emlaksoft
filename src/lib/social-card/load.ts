import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PortalListingLink } from "@/lib/social-card/core";
import { PUBLIC_COVER_COLUMNS, isPublicListingImage, selectWithDocumentFlag, type PublicCoverCandidate } from "@/lib/public-property-media";

/**
 * Sosyal kart verisi — oturumlu (RLS'li) istemciyle, açık tenant_id filtresiyle okunur. service_role YOK.
 * `eids_property_no` (20260826002950) yoksa ayrı sorguda hataya dayanıklı okunur (null).
 */
export type SocialCardData = {
  property: {
    id: string;
    code: string | null;
    title: string | null;
    transactionType: string | null;
    propertyType: string | null;
    listPrice: number | null;
    rooms: string | null;
    sqm: number | null;
    district: string | null;
    province: string | null;
  };
  eidsNo: string | null;
  office: { name: string | null; licenseNo: string | null; logoUrl: string | null; brandColor: string | null };
  listings: PortalListingLink[];
};

type Rel = { name?: string | null } | { name?: string | null }[] | null;
const nm = (v: Rel) => (Array.isArray(v) ? v[0]?.name : v?.name) ?? null;

export async function loadSocialCardData(db: SupabaseClient, tenantId: string, propertyId: string): Promise<SocialCardData | null> {
  const [{ data: p }, { data: t }, { data: listings }, eidsRes] = await Promise.all([
    db
      .from("properties")
      .select("id, property_code, title, transaction_type, property_type, list_price, features, province:geo_provinces(name), district:geo_districts(name)")
      .eq("id", propertyId)
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .maybeSingle(),
    db.from("tenants").select("name, license_no, logo_url, brand_color").eq("id", tenantId).maybeSingle(),
    db
      .from("portal_listings")
      .select("id, portal_name, status, portal_url")
      .eq("property_id", propertyId)
      .eq("tenant_id", tenantId)
      .order("published_at", { ascending: false })
      .limit(20),
    db.from("properties").select("eids_property_no").eq("id", propertyId).eq("tenant_id", tenantId).maybeSingle(),
  ]);
  if (!p) return null;
  const feat = (p.features ?? {}) as { rooms?: string | null; sqm?: number | string | null };
  const sqm = feat.sqm != null && Number.isFinite(Number(feat.sqm)) ? Number(feat.sqm) : null;
  return {
    property: {
      id: p.id as string,
      code: (p.property_code as string | null) ?? null,
      title: (p.title as string | null) ?? null,
      transactionType: (p.transaction_type as string | null) ?? null,
      propertyType: (p.property_type as string | null) ?? null,
      listPrice: p.list_price != null ? Number(p.list_price) : null,
      rooms: feat.rooms ?? null,
      sqm,
      district: nm(p.district as Rel),
      province: nm(p.province as Rel),
    },
    eidsNo: eidsRes.error ? null : ((eidsRes.data?.eids_property_no as string | null | undefined) ?? null),
    office: {
      name: (t?.name as string | null) ?? null,
      licenseNo: (t?.license_no as string | null) ?? null,
      logoUrl: (t?.logo_url as string | null) ?? null,
      brandColor: (t?.brand_color as string | null) ?? null,
    },
    listings: ((listings ?? []) as { id: string; portal_name: string | null; status: string | null; portal_url: string | null }[]).map((l) => ({
      id: l.id,
      portalName: l.portal_name,
      status: l.status,
      portalUrl: l.portal_url,
    })),
  };
}

const MAX_COVER_BYTES = 4 * 1024 * 1024;

/**
 * Kapak görseli → data URL; yoksa/okunamazsa null (kart fotoğrafsız çizilir). Kart sosyal medyada paylaşıldığı için
 * PUBLIC medya kuralından geçer (`src/lib/public-property-media.ts`, KVKK P0-9): belge (is_document / belge adlı dosya)
 * ASLA karta girmez; ilk public görsel kullanılır. Satori yalnız JPEG/PNG okur (webp ise fotoğrafsız).
 */
export async function loadCoverDataUrl(db: SupabaseClient, tenantId: string, propertyId: string): Promise<string | null> {
  const { data: rows } = await selectWithDocumentFlag<(PublicCoverCandidate & { storage_path: string | null })[]>(
    `${PUBLIC_COVER_COLUMNS}, storage_path`,
    (columns) =>
      db
        .from("property_media")
        .select(columns)
        .eq("property_id", propertyId)
        .eq("tenant_id", tenantId)
        .eq("kind", "image")
        .order("is_cover", { ascending: false })
        .order("sort_order", { ascending: true })
        .limit(20),
  );
  const media = (rows ?? []).find((m) => isPublicListingImage(m));
  const type = String(media?.file_type ?? "").toLowerCase();
  if (!media?.storage_path || !/^image\/(jpeg|png)$/.test(type)) return null;
  try {
    const { data: blob, error } = await db.storage.from("property-media").download(String(media.storage_path));
    if (error || !blob || blob.size > MAX_COVER_BYTES) return null;
    const buf = Buffer.from(await blob.arrayBuffer());
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}
