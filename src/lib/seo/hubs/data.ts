import "server-only";
import { unstable_cache } from "next/cache";
import { OPEN_LISTING_OR_FILTER } from "@/lib/closed-listing";
import { formatPublicPrice, listingCurrency } from "@/lib/public-price";
import { createAdminClient } from "@/lib/supabase/admin";
import { listingSlugInput, slugifyTr, vitrinListingPath, type ListingSlugRow } from "@/lib/vitrin/listing-slug";
import { loadIncludedOffices } from "../included-offices";
import { SEO_CACHE_TAG, getHubSettings, getSeoSettings } from "../store";
import type { SitemapEntry } from "../sitemap-rules";
import { computeHubs, hubDecision, roomsSlugOf, txSlugOf, type HubListing, type HubSummary } from "./rules";

/**
 * Programatik bölge sayfalarının verisi (sunucu, service_role, ÖNBELLEKLİ 30 dk). Kaynak kümesi sitemap ile AYNI
 * ofislerdir (`loadIncludedOffices`: aktif + vitrin açık + arama onayı + kalıcı noindex/örnek veri dışı). İlanlar:
 * yayında (status=live), silinmemiş, kapanmamış, ÖRNEK OLMAYAN (is_sample=false). Kişisel veri (adres satırı, sahip,
 * danışman) okunmaz; yalnız il/ilçe/mahalle adı, tip, oda, m², fiyat, başlık.
 */

export const HUB_CACHE_TAG = "seo-hubs";
const HUB_LISTING_CAP = 20_000;
const PAGE = 1000;

type Rel = { name?: string | null } | { name?: string | null }[] | null | undefined;
const relName = (v: Rel) => (Array.isArray(v) ? v[0]?.name : v?.name) ?? null;
const geo = (name: string | null) => (name && slugifyTr(name) ? { slug: slugifyTr(name), name } : null);

type Row = ListingSlugRow & {
  tenant_id: string;
  title: string | null;
  list_price: number | string | null;
  updated_at: string | null;
  sqm?: string | null;
  currency?: string | null;
  neighborhood?: Rel;
};

function toHubListing(r: Row, office: { slug: string; name: string } | undefined): HubListing | null {
  const tx = txSlugOf(r.transaction_type);
  const typeLabel = (r.property_type ?? "").trim();
  const type = slugifyTr(typeLabel);
  const il = geo(relName(r.province));
  if (!office || !tx || !type || !il) return null;
  const currency = listingCurrency({ currency: r.currency });
  const price = r.list_price === null || r.list_price === undefined ? null : Number(r.list_price);
  const okPrice = price !== null && Number.isFinite(price) && price > 0;
  const sqm = r.sqm ? Number(String(r.sqm).replace(",", ".")) : null;
  return {
    id: r.id,
    tenantId: String(r.tenant_id),
    officeSlug: office.slug,
    officeName: office.name,
    title: (r.title ?? "").trim().slice(0, 140) || typeLabel,
    tx,
    type,
    typeLabel,
    rooms: roomsSlugOf(r.rooms),
    il,
    ilce: geo(relName(r.district)),
    mahalle: geo(relName(r.neighborhood)),
    priceTry: currency === "TRY" && okPrice ? price : null,
    priceText: okPrice ? formatPublicPrice(price, r.transaction_type, currency) : null,
    sqm: sqm !== null && Number.isFinite(sqm) && sqm > 0 && sqm < 100_000 ? sqm : null,
    updatedAt: r.updated_at,
    href: vitrinListingPath(office.slug, listingSlugInput(r)),
  };
}

async function loadHubListingsFresh(): Promise<HubListing[]> {
  const settings = await getSeoSettings();
  const admin = createAdminClient();
  const offices = await loadIncludedOffices(admin, settings.sitemap);
  if (offices.size === 0) return [];
  const ids = [...offices.keys()];
  const out: HubListing[] = [];
  // Ofis kimlikleri 200'lük gruplarla sorgulanır (adres uzunluğu sınırı); toplam üst sınır HUB_LISTING_CAP.
  for (let g = 0; g < ids.length && out.length < HUB_LISTING_CAP; g += 200) {
    const group = ids.slice(g, g + 200);
    for (let from = 0; out.length < HUB_LISTING_CAP; from += PAGE) {
      const { data, error } = await admin
        .from("properties")
        .select(
          "id, tenant_id, title, transaction_type, property_type, list_price, updated_at, rooms:features->>rooms, sqm:features->>sqm, currency:features->>currency, district:geo_districts(name), province:geo_provinces(name), neighborhood:geo_neighborhoods(name)",
        )
        .in("tenant_id", group)
        .eq("status", "live")
        .eq("is_sample", false)
        .is("deleted_at", null)
        .or(OPEN_LISTING_OR_FILTER)
        .order("id")
        .range(from, from + PAGE - 1);
      // Hata = veri sonu DEĞİL: eksik küme önbelleğe girerse bölge sayfaları 30 dk yanlış noindex/404 alır. Atılan hata
      // `unstable_cache`e yazılmaz; önceki iyi değer korunur (çağıranlar kendi düşüşünü uygular).
      if (error) throw new Error(`seo_hub_listings_failed: ${(error as { code?: string }).code ?? "db"}`);
      const rows = (data ?? []) as unknown as Row[];
      for (const r of rows) {
        const item = toHubListing(r, offices.get(String(r.tenant_id)));
        if (item) out.push(item);
      }
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

/** Önbellekli ilan kümesi (bölge sayfaları, sitemap, yönetim önizlemesi). */
export const getHubListings = unstable_cache(loadHubListingsFresh, ["seo-hub-listings-v1"], { tags: [SEO_CACHE_TAG, HUB_CACHE_TAG], revalidate: 1800 });

export async function loadHubIndex(): Promise<{ listings: HubListing[]; hubs: HubSummary[] }> {
  const [settings, listings] = await Promise.all([getHubSettings(), getHubListings()]);
  return { listings, hubs: computeHubs(listings, settings) };
}

/** Sitemap girdileri: yalnız eşiği geçen (index) hub'lar; lastmod = kümedeki en yeni ilan güncellemesi. */
export async function hubSitemapEntries(base: string): Promise<SitemapEntry[]> {
  const settings = await getHubSettings();
  if (!settings.enabled) return [];
  const { hubs } = await loadHubIndex();
  const b = base.replace(/\/+$/, "");
  return hubs
    .filter((h) => hubDecision(h.count, settings) === "index")
    .map((h) => ({
      url: `${b}${h.path}`,
      ...(h.lastmod ? { lastModified: new Date(h.lastmod).toISOString() } : {}),
      changeFrequency: "daily" as const,
      priority: h.level === "il" ? 0.6 : 0.5,
    }));
}
