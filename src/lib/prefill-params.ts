/**
 * "Yeni kayıt" sayfalarının ön dolgu parametreleri — tek sözleşme.
 *
 * Geçmişte sayfalar farklı adlar kabul ediyordu (teklif/kiralama `?musteri=&portfoy=`, randevu/sözleşme/görev
 * `?customer=&property=`). Artık hepsi iki yazımı da kabul eder; yeni bağlantılar yalnız KANONİK adları
 * (`customer`, `property`, `demand`, `deal`) üretir (`prefillHref`). Değer UUID değilse yok sayılır (sorguya bozuk id gitmez).
 *
 * Bağlam kuralı (kolay akış): bir kayıttan (müşteri 360, portföy, talep, anlaşma, eşleştirme) açılan her "yeni"
 * bağlantısı o kaydın kimliğini taşır; hedef sayfa `readPrefillIds` / `readPrefillContext` ile okuyup seçiciyi ön seçili
 * açar (yine değiştirilebilir). `scripts/check-link-contracts.ts` bu yardımcıyı çağıran sayfaların aşağıdaki
 * adların hepsini okuduğunu bilir; `src/lib/prefill-context-contract.test.ts` bağlantıları kilitler.
 */

export const PREFILL_PARAM = { customer: "customer", property: "property", demand: "demand", deal: "deal" } as const;

/** Kabul edilen eş adlar (ilk eşleşen kazanır; kanonik ad önce). */
export const PREFILL_ALIASES = {
  customer: ["customer", "musteri"],
  property: ["property", "portfoy"],
  demand: ["demand", "talep"],
  deal: ["deal", "anlasma"],
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PrefillSearchParams = Record<string, string | string[] | undefined>;

export type PrefillIds = { customerId: string | null; propertyId: string | null };

export type PrefillContext = PrefillIds & { demandId: string | null; dealId: string | null };

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

/** Tek değerli UUID parametresi (ör. `?deal=`); geçersiz/boş → null. */
export function readUuidParam(sp: PrefillSearchParams | null | undefined, ...names: string[]): string | null {
  return pick(sp ?? {}, names);
}

/** `?customer=|?musteri=` ve `?property=|?portfoy=` değerlerini okur (geçersiz/boş → null). */
export function readPrefillIds(sp: PrefillSearchParams | null | undefined): PrefillIds {
  const src = sp ?? {};
  return { customerId: pick(src, PREFILL_ALIASES.customer), propertyId: pick(src, PREFILL_ALIASES.property) };
}

/** `readPrefillIds` + `?demand=|?talep=` ve `?deal=|?anlasma=` (talep / anlaşma bağlamı). */
export function readPrefillContext(sp: PrefillSearchParams | null | undefined): PrefillContext {
  const src = sp ?? {};
  return {
    ...readPrefillIds(src),
    demandId: pick(src, PREFILL_ALIASES.demand),
    dealId: pick(src, PREFILL_ALIASES.deal),
  };
}

/** Kanonik adlarla ön dolgu bağlantısı üretir; boş değerler eklenmez. */
export function prefillHref(
  path: string,
  ids: { customerId?: string | null; propertyId?: string | null; demandId?: string | null; dealId?: string | null },
  extra?: Record<string, string | null | undefined>,
): string {
  const qs = new URLSearchParams();
  if (ids.customerId) qs.set(PREFILL_PARAM.customer, ids.customerId);
  if (ids.propertyId) qs.set(PREFILL_PARAM.property, ids.propertyId);
  if (ids.demandId) qs.set(PREFILL_PARAM.demand, ids.demandId);
  if (ids.dealId) qs.set(PREFILL_PARAM.deal, ids.dealId);
  for (const [k, v] of Object.entries(extra ?? {})) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}
