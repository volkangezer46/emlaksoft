/**
 * Vitrin ilan adresi (tek kaynak): `/vitrin/{ofisSlug}/{açıklayıcı-kısım}-{kod}` — ör.
 * `/vitrin/demo-emlak/kadikoy-3-1-satilik-daire-1a2b3c4d5e6f`.
 *
 * - `{kod}` ilanın uuid'sinin ilk 12 onaltılık hanesidir (gen_random_uuid v4: bu 48 bit tamamen rastgele). Ofis içinde
 *   çakışma olasılığı ihmal edilebilir; yine de çözümleme kiracı filtresiyle aralık sorgusu yapar ve 1'den fazla kayıt
 *   dönerse ilanı BULUNAMADI sayar (yanlış ilan asla gösterilmez). `property_code` kullanılmaz: serbest metin olabilir
 *   (örnek veri, içe aktarma), tire içerir ve büyük/küçük harf duyarlıdır → adres parçasından güvenle ayrıştırılamaz.
 * - Açıklayıcı kısım dekoratiftir: çözümleme yalnız `{kod}` ile yapılır; kısım uyuşmazsa sayfa normal çizilir ve
 *   canonical doğru adresi gösterir (yönlendirme yok).
 *
 * Herkese açık ilan adresi kuran HER yer (kartlar, sitemap, canonical, JSON-LD, IndexNow, paylaşım, QR, favoriler,
 * yayından kalkan ilan görünümü, e-posta/mesaj şablonları) `vitrinListingPath`/`vitrinListingUrl` kullanır.
 */

/** Kod uzunluğu (onaltılık hane). */
export const LISTING_KOD_LENGTH = 12;
/** Adres parçası (açıklayıcı kısım + kod) üst sınırı. */
export const LISTING_SLUG_MAX = 80;

const KOD_RE = new RegExp(`^[0-9a-f]{${LISTING_KOD_LENGTH}}$`);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TR_MAP: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };

/** Türkçe duyarlı adres parçası: küçük harf, ç/ğ/ı/İ/ö/ş/ü → ASCII, harf/rakam dışı → tek tire. */
export function slugifyTr(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıöşü]/g, (ch) => TR_MAP[ch])
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const TX_ALIASES: Record<string, string> = { sale: "satilik", rent: "kiralik", "daily-rent": "gunluk-kiralik", transfer: "devren" };

export type ListingSlugInput = {
  id: string;
  /** İlçe adı (yoksa il adı kullanılır). */
  district?: string | null;
  province?: string | null;
  /** features.rooms (ör. "3+1"). */
  rooms?: string | null;
  transactionType?: string | null;
  propertyType?: string | null;
};

/** uuid → kısa kod (ilk 12 onaltılık hane, küçük harf). Geçersiz id'de boş dize. */
export function listingKod(id: string): string {
  if (!UUID_RE.test(id)) return "";
  return id.replace(/-/g, "").slice(0, LISTING_KOD_LENGTH).toLowerCase();
}

/** Açıklayıcı kısım + kod; en çok LISTING_SLUG_MAX karakter (kısım tire sınırında kesilir, kod korunur). */
export function listingSlug(input: ListingSlugInput): string {
  const kod = listingKod(input.id);
  const tx = slugifyTr(input.transactionType);
  const parts = [
    slugifyTr(input.district) || slugifyTr(input.province),
    slugifyTr(input.rooms),
    TX_ALIASES[tx] ?? tx,
    slugifyTr(input.propertyType),
  ].filter(Boolean);
  const room = LISTING_SLUG_MAX - kod.length - 1;
  let desc = parts.join("-");
  if (desc.length > room) {
    desc = desc.slice(0, room + 1);
    const cut = desc.lastIndexOf("-");
    desc = (cut > 0 ? desc.slice(0, cut) : desc.slice(0, room)).replace(/-+$/, "");
  }
  return `${desc || "ilan"}-${kod}`;
}

/** Göreli herkese açık ilan yolu. */
export function vitrinListingPath(officeSlug: string, input: ListingSlugInput): string {
  return `/vitrin/${officeSlug}/${listingSlug(input)}`;
}

/** Mutlak herkese açık ilan adresi (`base` sonundaki eğik çizgi atılır). */
export function vitrinListingUrl(base: string, officeSlug: string, input: ListingSlugInput): string {
  return `${base.replace(/\/$/, "")}${vitrinListingPath(officeSlug, input)}`;
}

/** Adres parçasından kod: son tireden sonraki 12 onaltılık hane; biçim dışıysa (ya da tam uuid ise) null. */
export function parseListingKod(segment: string | null | undefined): string | null {
  if (!segment) return null;
  let s = segment;
  try {
    s = decodeURIComponent(segment);
  } catch {
    /* ham parça kullanılır */
  }
  // Eski uuid adresi bilerek desteklenmez (son grubu da 12 hanedir; başka ilana denk gelmesin).
  if (UUID_RE.test(s)) return null;
  const kod = s.slice(s.lastIndexOf("-") + 1).toLowerCase();
  return KOD_RE.test(kod) ? kod : null;
}

/** Kodun kapsadığı uuid aralığı (PostgREST `.gte("id", lo).lte("id", hi)`; birincil anahtar indeksi kullanılır). */
export function listingKodIdRange(kod: string): { lo: string; hi: string } {
  const lo = `${kod}${"0".repeat(32 - kod.length)}`;
  const hi = `${kod}${"f".repeat(32 - kod.length)}`;
  const fmt = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  return { lo: fmt(lo), hi: fmt(hi) };
}

/** Aralık sorgusu sonucu (en çok 2 satır istenir): tam bir kayıt varsa o, yoksa ya da belirsizse null. */
export function pickUniqueByKod<T extends { id: string }>(rows: readonly T[] | null | undefined, kod: string): T | null {
  const hits = (rows ?? []).filter((r) => listingKod(r.id) === kod);
  return hits.length === 1 ? hits[0] : null;
}

type RelName = { name?: string | null } | { name?: string | null }[] | null | undefined;
const relName = (v: RelName) => (Array.isArray(v) ? v[0]?.name : v?.name) ?? null;

/** Sorgu satırı (PostgREST ilişki biçimi) → slug girdisi. Seçimde: id, transaction_type, property_type, features (ya da
 *  yalnız `rooms:features->>rooms`), district:geo_districts(name), province:geo_provinces(name). */
export type ListingSlugRow = {
  id: string;
  transaction_type?: string | null;
  property_type?: string | null;
  features?: unknown;
  /** `rooms:features->>rooms` seçimi (features tamamı okunmadan; sitemap gibi toplu sorgular). */
  rooms?: string | null;
  district?: RelName;
  province?: RelName;
};

/** Slug için gereken en az sütunlar (toplu sorgular; features tamamı okunmaz). */
export const LISTING_SLUG_COLUMNS =
  "id, transaction_type, property_type, rooms:features->>rooms, district:geo_districts(name), province:geo_provinces(name)";

export function listingSlugInput(row: ListingSlugRow): ListingSlugInput {
  const rooms = row.rooms ?? (row.features as { rooms?: unknown } | null | undefined)?.rooms;
  return {
    id: row.id,
    district: relName(row.district),
    province: relName(row.province),
    rooms: typeof rooms === "string" || typeof rooms === "number" ? String(rooms) : null,
    transactionType: row.transaction_type ?? null,
    propertyType: row.property_type ?? null,
  };
}
