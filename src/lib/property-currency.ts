/**
 * Portföy fiyatının para birimi (SAF; istemci ve sunucu güvenli). B094.
 *
 * Tek kaynak `properties.currency` sütunudur (TRY | USD | EUR, varsayılan TRY; migration 20261016090000).
 * Paketler arası sözleşme (f): portföy kaydı hem sütuna hem `features.currency`'ye (portal aktarımı ve herkese
 * açık yüzeyler için "TL" | "USD" | "EUR") yazar. Okurken önce sütun, yoksa `features.currency` kullanılır.
 *
 * Fiyat sağlığı, emsal ve eşleşme bütçesi ₺ ölçeğinde çalışır: döviz fiyatı TCMB satış kuruyla ₺ karşılığına
 * çevrilir (`toTryAmount`); kur yoksa sahte "Riskli" yerine "döviz: değerlendirilemedi" denir.
 */
import { formatListingPrice, formatMoney } from "@/lib/format";
import { toTryAmount, type FxRates } from "@/lib/fx";

export type PropertyCurrency = "TRY" | "USD" | "EUR";

/** Fiyat sekmesindeki seçici: değer `features.currency` biçimiyle aynı (portal aktarımı "TL" bekler). */
export const PROPERTY_CURRENCY_OPTIONS = [
  { value: "TL", label: "TL (₺)" },
  { value: "USD", label: "ABD doları ($)" },
  { value: "EUR", label: "Avro (€)" },
] as const;

/** Kur yokken döviz fiyatın sağlık etiketi. */
export const FX_UNRATED_LABEL = "döviz: değerlendirilemedi";

/** "TL"/"TRY"/"₺" → TRY, "USD"/"$" → USD, "EUR"/"€" → EUR; tanınmayan/boş → null. */
export function normalizePropertyCurrency(raw: unknown): PropertyCurrency | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toUpperCase();
  if (s === "TL" || s === "TRY" || s === "₺") return "TRY";
  if (s === "USD" || s === "$") return "USD";
  if (s === "EUR" || s === "€") return "EUR";
  return null;
}

/** Kaydın para birimi: önce sütun, yoksa `features.currency`, ikisi de yoksa TRY. */
export function propertyCurrency(row: { currency?: unknown; features?: unknown } | null | undefined): PropertyCurrency {
  const fromColumn = normalizePropertyCurrency(row?.currency);
  if (fromColumn) return fromColumn;
  const features = row?.features && typeof row.features === "object" ? (row.features as Record<string, unknown>) : null;
  return normalizePropertyCurrency(features?.currency) ?? "TRY";
}

/** `features.currency` yazım biçimi (CURRENCY_OPTIONS: TL | USD | EUR). */
export function currencyFeatureValue(currency: PropertyCurrency): "TL" | "USD" | "EUR" {
  return currency === "TRY" ? "TL" : currency;
}

const isRent = (transaction: string | null | undefined) =>
  transaction === "rent" || transaction === "Kiralık" || transaction === "kiralik";

/**
 * Liste ve detayda portföy fiyatı: TRY'de "₺1.234" (+ kiralıkta "/ay") biçimi korunur;
 * USD/EUR `formatMoney` ile kendi simgesiyle basılır ("$850.000").
 */
export function formatPropertyPrice(
  value: number | null | undefined,
  transaction: string | null | undefined,
  currency: PropertyCurrency,
  emptyLabel = "Fiyat girilmedi",
): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return emptyLabel;
  if (currency === "TRY") return formatListingPrice(Number(value), transaction ?? "", emptyLabel);
  return `${formatMoney(Number(value), currency)}${isRent(transaction) ? "/ay" : ""}`;
}

/** Tutarı portföyün para biriminde basar (komisyon önizlemesi vb.); boşsa "—". */
export function formatPropertyMoney(value: number | null | undefined, currency: PropertyCurrency): string {
  return formatMoney(value == null || !Number.isFinite(Number(value)) ? null : Number(value), currency);
}

/**
 * Fiyat sağlığı/emsal için ₺ ölçeğinde fiyat. TRY'de fiyatın kendisi; dövizde TCMB satış kuruyla çevrilir.
 * `unrated: true` → döviz fiyat ama kur yok: sağlık hesaplanmaz, "döviz: değerlendirilemedi" gösterilir.
 */
export function priceForHealth(
  listPrice: number | null | undefined,
  currency: PropertyCurrency,
  rates: FxRates | null,
): { priceTry: number | null; unrated: boolean } {
  if (listPrice === null || listPrice === undefined || !Number.isFinite(Number(listPrice))) {
    return { priceTry: null, unrated: false };
  }
  if (currency === "TRY") return { priceTry: Number(listPrice), unrated: false };
  const priceTry = toTryAmount(Number(listPrice), currency, rates);
  return { priceTry, unrated: priceTry === null };
}
