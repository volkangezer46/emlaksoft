import { createAdminClient } from "@/lib/supabase/admin";
import { isVitrinEnabled } from "@/lib/vitrin-settings";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { OPEN_LISTING_OR_FILTER } from "@/lib/closed-listing";
import { OG_SIZE, renderVitrinOg } from "@/lib/vitrin-og";
import { loadOgPhoto } from "@/lib/public-link-og";
import { formatPublicPrice, listingCurrency } from "@/lib/public-price";
import { listingKodIdRange, parseListingKod, pickUniqueByKod } from "@/lib/vitrin/listing-slug";

export const alt = "Emlak ilanı";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 300;

type Rel = { name?: string } | { name?: string }[] | null;
const nm = (v: Rel) => (Array.isArray(v) ? v[0]?.name : v?.name) ?? null;

/**
 * İlan başına dinamik paylaşım kartı (WhatsApp/sosyal önizleme; twitter-image.tsx aynı kartı verir). DİKKAT (Next 16,
 * resolve-metadata hasOwnProperty('images')): sayfa metadata'sında `openGraph.images`/`twitter.images` anahtarı VARSA
 * (undefined bile) bu dosya görseli EKLENMEZ; bu yüzden sayfa o anahtarı hiç yazmaz (SK8 B151). Fotoğraf kararı burada:
 * ilk public ilan görseli varsa kartın arka planı olur, fotoğrafsız ilanda markalı yedek kart (ofis, başlık, fiyat).
 */
export default async function Image({ params }: { params: Promise<{ slug: string; ilan: string }> }) {
  const { slug, ilan } = await params;
  // Yalnız `{kod}` çözülür (src/lib/vitrin/listing-slug.ts); açıklayıcı kısım dekoratif.
  const kod = parseListingKod(ilan);
  const range = kod ? listingKodIdRange(kod) : null;
  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, status, logo_url, brand_color")
    .eq("slug", slug)
    .maybeSingle();
  const active = tenant && isPublicTenantActive(tenant.status) && (await isVitrinEnabled(admin, tenant.id));
  const { data: rows } = active && range
    ? await admin
        .from("properties")
        .select("id, title, property_code, transaction_type, list_price, features, province:geo_provinces(name), district:geo_districts(name)")
        .gte("id", range.lo)
        .lte("id", range.hi)
        .eq("tenant_id", tenant.id)
        .eq("status", "live")
        .is("deleted_at", null)
        .eq("is_sample", false)
        .or(OPEN_LISTING_OR_FILTER)
        .limit(2)
    : { data: null };
  const p = kod ? pickUniqueByKod(rows, kod) : null;

  if (!tenant || !active || !p) {
    return renderVitrinOg({ office: "EmlakSoft", title: "İlan bulunamadı" });
  }
  const feat = (p.features ?? {}) as { rooms?: string; sqm?: number };
  // Fiyat ilanın para biriminden (SK8 B094).
  const price =
    p.list_price != null ? formatPublicPrice(Number(p.list_price), p.transaction_type, listingCurrency(p.features)) : null;
  const photo = await loadOgPhoto(tenant.id, [p.id as string]);
  return renderVitrinOg({
    photo,
    office: tenant.name ?? "EmlakSoft",
    logoUrl: tenant.logo_url,
    brandColor: tenant.brand_color,
    badge: p.transaction_type,
    title: p.title || p.property_code,
    location: [nm(p.district as Rel), nm(p.province as Rel)].filter(Boolean).join(", ") || null,
    price,
    specs: [feat.rooms, feat.sqm ? `${feat.sqm} m²` : null].filter(Boolean) as string[],
  });
}
