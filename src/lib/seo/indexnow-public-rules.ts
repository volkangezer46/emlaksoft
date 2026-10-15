import { trDayKey } from "@/lib/clock";
import { isClosedListing } from "@/lib/closed-listing";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { vitrinIndexable, type NeverIndexTenant } from "@/lib/vitrin-seo/never-index";
import { indexNowPrint } from "./indexnow-events";
import { listingKod, listingSlugInput, vitrinListingPath, type ListingSlugRow } from "@/lib/vitrin/listing-slug";

/**
 * Herkese açık içerik yayın anı IndexNow kuralları (SAF — sunucu ve test ortak).
 *
 * İlan (vitrin ilan detayı) yalnız şu durumda bildirilir — sitemap (sitemap-data.ts) ve sayfa robots kararıyla AYNI ölçüt:
 *  - ofis herkese açık durumda (trial/active/past_due), vitrini açık (vitrin_enabled) ve
 *  - ofis arama onayı VAR (tenants.vitrin_seo_optin) ve kalıcı noindex listesinde DEĞİL (vitrin-seo/never-index.ts) ve
 *  - sitemap'te vitrin ilanları açık (seo.sitemap.vitrinListings) ve
 *  - ilan yayında (status=live), silinmemiş, örnek değil, "kapandı" işaretli değil.
 * Tekrar/sıklık: aynı adres+lastmod (günlük sitemap farkıyla ortak `seo.indexnow.seen` parmak izi) ya da aynı adres
 * aynı gün (olay parmak izi) ikinci kez GÖNDERİLMEZ; gün içindeki sonraki düzenlemeyi ertesi günkü sitemap farkı taşır.
 */

/** Yayındaki ilan durumu (properties.status). */
export const LIVE_LISTING_STATUS = "live";

export type ListingIndexNowTenant = NeverIndexTenant & {
  status: string | null | undefined;
  /** Ofis vitrin ayarları (loadVitrinSettings): yoksa varsayılan = onay yok. */
  vitrinEnabled: boolean;
  seoOptin: boolean;
};

/** Slug sütunları (transaction_type, property_type, features.rooms, ilçe/il) kanonik okunur adres için gerekir. */
export type ListingIndexNowListing = ListingSlugRow & {
  status: string | null | undefined;
  is_sample?: boolean | null;
  deleted_at?: string | null;
};

export type IndexNowEligibility = { ok: true; path: string } | { ok: false; reason: string };

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** İlan adresi IndexNow'a bildirilebilir mi? Uygunsa kanonik vitrin ilan yolu (/vitrin/<ofis>/<okunur-slug>-<kod>). */
export function listingIndexNowEligibility(input: {
  tenant: ListingIndexNowTenant | null | undefined;
  listing: ListingIndexNowListing | null | undefined;
  neverIndexList: readonly string[];
  sitemapListingsOn: boolean;
}): IndexNowEligibility {
  const { tenant, listing } = input;
  if (!tenant || !listing) return { ok: false, reason: "kayıt yok" };
  if (!isPublicTenantActive(tenant.status)) return { ok: false, reason: "ofis herkese açık değil" };
  if (!tenant.vitrinEnabled) return { ok: false, reason: "vitrin kapalı" };
  if (!vitrinIndexable(tenant.seoOptin, tenant, input.neverIndexList)) return { ok: false, reason: "vitrin indekslenmiyor" };
  if (!input.sitemapListingsOn) return { ok: false, reason: "vitrin ilanları site haritasında kapalı" };
  if (listing.status !== LIVE_LISTING_STATUS) return { ok: false, reason: "ilan yayında değil" };
  if (listing.deleted_at) return { ok: false, reason: "ilan silinmiş" };
  if (listing.is_sample === true) return { ok: false, reason: "örnek ilan" };
  if (isClosedListing(listing.features)) return { ok: false, reason: "ilan kapandı" };
  const slug = typeof tenant.slug === "string" ? tenant.slug.trim().toLowerCase() : "";
  if (!SLUG_RE.test(slug) || !listingKod(listing.id)) return { ok: false, reason: "adres üretilemedi" };
  return { ok: true, path: vitrinListingPath(slug, listingSlugInput(listing)) };
}

/**
 * Olay bildirimi parmak izleri: `lastmod` (günlük sitemap farkıyla ortak; runIndexNow aynı adresi yeniden göndermez)
 * ve `day` (aynı adres aynı gün en çok bir olay bildirimi).
 */
export function indexNowEventPrints(url: string, lastModified: string | undefined, nowMs: number): { lastmod: string; day: string } {
  return { lastmod: indexNowPrint(url, lastModified), day: indexNowPrint(url, `olay:${trDayKey(nowMs)}`) };
}

/** Bu olay daha önce (aynı lastmod ya da aynı gün) bildirildi mi? */
export function indexNowEventAlreadySent(seen: ReadonlySet<string>, prints: { lastmod: string; day: string }): boolean {
  return seen.has(prints.lastmod) || seen.has(prints.day);
}
