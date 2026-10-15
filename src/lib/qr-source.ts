/**
 * QR'lı tabela / basılı materyal kaynak etiketi (SAF; istemci ve sunucu güvenle import eder).
 *
 * Akış: portföy QR'ı vitrin ilan sayfasına `?kaynak=qr` ile gider → vitrin talep formu bu değeri gizli alanla taşır →
 * başvuru `source = "qr"` ile kaydedilir → kaynak raporunda "QR tabela" satırı olarak görünür.
 * Kaynak değeri yalnız beyaz listedeyse kabul edilir (URL'den serbest metin kaynak alanına YAZILMAZ).
 */

import { vitrinListingUrl, type ListingSlugInput } from "@/lib/vitrin/listing-slug";

export const QR_SOURCE = "qr";
export const QR_SOURCE_PARAM = "kaynak";
export const QR_SOURCE_LABEL = "QR tabela";

/** URL'den gelebilecek kabul edilen kaynak etiketleri (şimdilik yalnız QR). */
const ALLOWED_URL_SOURCES = new Set([QR_SOURCE]);

export function parseUrlSource(raw: unknown): string | null {
  const v = String(Array.isArray(raw) ? raw[0] : (raw ?? "")).trim().toLowerCase();
  return ALLOWED_URL_SOURCES.has(v) ? v : null;
}

/** Vitrin ilan sayfasının QR hedef adresi (kanonik okunur adres + kaynak etiketi). Slug yoksa null (QR üretilmez). */
export function buildQrListingUrl(baseUrl: string, slug: string | null | undefined, listing: ListingSlugInput): string | null {
  if (!slug) return null;
  return `${vitrinListingUrl(baseUrl, encodeURIComponent(slug), listing)}?${QR_SOURCE_PARAM}=${QR_SOURCE}`;
}

/** Harici QR görsel servisi (goqr.me; gerekçe `components/public/vitrin-qr.tsx`). Yalnız public ilan URL'i iletilir. */
export function qrImageSrc(targetUrl: string, size = 300): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=2&format=png&data=${encodeURIComponent(targetUrl)}`;
}
