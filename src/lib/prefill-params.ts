/**
 * "Yeni kayıt" sayfalarının ön dolgu parametreleri — tek sözleşme.
 *
 * Geçmişte sayfalar farklı adlar kabul ediyordu (teklif/kiralama `?musteri=&portfoy=`, randevu/sözleşme/görev
 * `?customer=&property=`). Artık hepsi iki yazımı da kabul eder; yeni bağlantılar yalnız KANONİK adları
 * (`customer`, `property`) üretir (`prefillHref`). Değer UUID değilse yok sayılır (sorguya bozuk id gitmez).
 */

export const PREFILL_PARAM = { customer: "customer", property: "property" } as const;

/** Kabul edilen eş adlar (ilk eşleşen kazanır; kanonik ad önce). */
const ALIASES = {
  customer: ["customer", "musteri"],
  property: ["property", "portfoy"],
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PrefillSearchParams = Record<string, string | string[] | undefined>;

export type PrefillIds = { customerId: string | null; propertyId: string | null };

function firstValue(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? (v[0] ?? "") : (v ?? "")).trim();
}

function pick(sp: PrefillSearchParams, names: readonly string[]): string | null {
  for (const name of names) {
    const value = firstValue(sp[name]);
    if (value) return UUID_RE.test(value) ? value : null;
  }
  return null;
}

/** `?customer=|?musteri=` ve `?property=|?portfoy=` değerlerini okur (geçersiz/boş → null). */
export function readPrefillIds(sp: PrefillSearchParams | null | undefined): PrefillIds {
  const src = sp ?? {};
  return { customerId: pick(src, ALIASES.customer), propertyId: pick(src, ALIASES.property) };
}

/** Kanonik adlarla ön dolgu bağlantısı üretir; boş değerler eklenmez. */
export function prefillHref(
  path: string,
  ids: { customerId?: string | null; propertyId?: string | null },
  extra?: Record<string, string | null | undefined>,
): string {
  const qs = new URLSearchParams();
  if (ids.customerId) qs.set(PREFILL_PARAM.customer, ids.customerId);
  if (ids.propertyId) qs.set(PREFILL_PARAM.property, ids.propertyId);
  for (const [k, v] of Object.entries(extra ?? {})) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}
