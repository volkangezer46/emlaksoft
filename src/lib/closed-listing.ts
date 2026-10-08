/**
 * Kapalı (gizli) portföy — TEK KAYNAK (SAF). Kapalı portföy vitrinde, müşteri portalında, public API/site haritasında ve portal
 * (sahibinden vb.) yayınında GÖRÜNMEZ; yalnız ofis içinde ve (ofis ağına açıkça paylaşıldıysa) ofis ağı eşleşmesinde yer alır.
 *
 * Depo: `properties.features.closed_listing = true` (jsonb; yeni sütun/migration YOK, şema yokken de güvenlidir). Ofis ağına
 * paylaşım ayrı ve açıktır (`network_listings`, opt-in): kapalı bayrağı ağ paylaşımını kendiliğinden açmaz ya da kapatmaz.
 *
 * KURAL: public bir yüzeyde `properties` okuyan her sorgu `excludeClosedListings(query)` çağırır
 * (`closed-listing-contract.test.ts` bu yüzeyleri kilitler). Bayrağı olmayan satır (null) açık sayılır.
 */

export const CLOSED_LISTING_FEATURE_KEY = "closed_listing";

/** PostgREST `or` süzgeci: anahtar yok ya da "true" değil -> açık. (`neq` tek başına NULL'ı da eler, bu yüzden `is.null` ile birlikte.) */
export const OPEN_LISTING_OR_FILTER = `features->>${CLOSED_LISTING_FEATURE_KEY}.is.null,features->>${CLOSED_LISTING_FEATURE_KEY}.neq.true`;

type OrFilterable<T> = { or: (filters: string) => T };

/** Public sorguya "kapalı portföyü hariç tut" süzgeci ekler. */
export function excludeClosedListings<T extends OrFilterable<T>>(query: T): T {
  return query.or(OPEN_LISTING_OR_FILTER);
}

/** `features` jsonb'i kapalı portföy mü? (yalnız boolean true ya da "true" metni). */
export function isClosedListing(features: unknown): boolean {
  if (!features || typeof features !== "object" || Array.isArray(features)) return false;
  const v = (features as Record<string, unknown>)[CLOSED_LISTING_FEATURE_KEY];
  return v === true || v === "true";
}

/** `features` kopyasına bayrağı yazar (kapalıysa true, açıksa anahtar SİLİNİR; diğer anahtarlar korunur). */
export function withClosedFlag(features: Record<string, unknown> | null | undefined, closed: boolean): Record<string, unknown> {
  const next = { ...(features ?? {}) };
  if (closed) next[CLOSED_LISTING_FEATURE_KEY] = true;
  else delete next[CLOSED_LISTING_FEATURE_KEY];
  return next;
}

export const CLOSED_LISTING_LABEL = "Kapalı portföy";
export const CLOSED_LISTING_HINT =
  "Vitrinde, müşteri portalında ve ilan portallarında görünmez; yalnız ofis içinde (eşleştirme dahil) kullanılır. Ofis ağıyla paylaşım ayrıca, açıkça yapılır.";
