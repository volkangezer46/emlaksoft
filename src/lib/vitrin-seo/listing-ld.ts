import type { LdNode } from "@/lib/seo/jsonld";
import { vitrinListingBreadcrumbLd } from "./breadcrumb";
import { vitrinListingUrl, type ListingSlugInput } from "@/lib/vitrin/listing-slug";

/**
 * İlan detayı JSON-LD grafiği (SAF): RealEstateListing + BreadcrumbList. Çıktı sayfada `serializeJsonLd` ile basılır.
 *  - `image[]` yalnız gerçekten var olan public görsellerden (belge değil) üretilir; görsel yoksa alan HİÇ yazılmaz.
 *  - Offer'a `priceValidUntil` eklenmez (uydurma tarih yok); fiyat yoksa Offer yok; `priceCurrency` ilanın para birimi.
 *  - Konum gizliliği (SK8 B152): `streetAddress` yalnız verilirse yazılır; geo yaklaşık (3 ondalık) koordinattır.
 */

export const LISTING_LD_MAX_IMAGES = 10;

export type VitrinListingLdInput = {
  base: string;
  slug: string;
  /** Kanonik ilan adresi girdisi (tek kaynak: src/lib/vitrin/listing-slug.ts). */
  listing: ListingSlugInput;
  name: string;
  description: string | null;
  officeName: string | null;
  imageIds: readonly string[];
  createdAt?: string | null;
  price: number | null;
  /** İlanın para birimi (features.currency → TRY|USD|EUR; SK8 B094). Yoksa TRY. */
  currency?: "TRY" | "USD" | "EUR";
  sqm: number | null;
  lat?: number | null;
  lng?: number | null;
  /** Yalnız ofis açık konumu bilerek yayınladığında (public-location.ts); varsayılan gizlilikte null → alan yazılmaz. */
  streetAddress?: string | null;
  district?: string | null;
  province?: string | null;
};

export function listingImageUrls(base: string, ids: readonly string[], max: number = LISTING_LD_MAX_IMAGES): string[] {
  return [...new Set(ids.filter(Boolean))].slice(0, max).map((id) => `${base}/api/property-media/${id}`);
}

export function buildVitrinListingLd(input: VitrinListingLdInput): LdNode {
  const url = vitrinListingUrl(input.base, input.slug, input.listing);
  const images = listingImageUrls(input.base, input.imageIds);
  const hasGeo = input.lat != null && input.lng != null && Number.isFinite(input.lat) && Number.isFinite(input.lng);
  const listing: LdNode = {
    "@type": "RealEstateListing",
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    url,
    ...(images.length > 0 ? { image: images } : {}),
    ...(input.createdAt ? { datePosted: input.createdAt } : {}),
    ...(input.price != null
      ? { offers: { "@type": "Offer", price: input.price, priceCurrency: input.currency ?? "TRY", availability: "https://schema.org/InStock" } }
      : {}),
    ...(input.sqm ? { floorSize: { "@type": "QuantitativeValue", value: input.sqm, unitCode: "MTK" } } : {}),
    ...(hasGeo ? { geo: { "@type": "GeoCoordinates", latitude: input.lat, longitude: input.lng } } : {}),
    address: {
      "@type": "PostalAddress",
      ...(input.streetAddress ? { streetAddress: input.streetAddress } : {}),
      ...(input.district ? { addressLocality: input.district } : {}),
      ...(input.province ? { addressRegion: input.province } : {}),
      addressCountry: "TR",
    },
    provider: {
      "@type": "RealEstateAgent",
      name: input.officeName ?? "EmlakSoft",
      url: `${input.base}/vitrin/${input.slug}`,
    },
  };
  const breadcrumb = vitrinListingBreadcrumbLd({
    base: input.base,
    slug: input.slug,
    officeName: input.officeName,
    district: input.district,
    province: input.province,
    listingUrl: url,
    listingName: input.name,
  });
  return { "@context": "https://schema.org", "@graph": [listing, breadcrumb] };
}
