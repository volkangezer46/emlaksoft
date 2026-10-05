/**
 * Ortak biçimleyiciler — para ve tarih için tek kaynak.
 *
 * Eski yerel kopyalar (formatTry/formatTl/formatPrice, fmtDate/formatDate ...) çıktılarını
 * değiştirmeden bu modüle taşındı. Çıktısı farklı olan biçimler ayrı adlarla durur;
 * birbirine "benziyor" diye birleştirilmedi.
 *
 * Tarihler Türkiye saat diliminde (Europe/Istanbul) biçimlenir: sunucu (UTC) ve istemci aynı
 * metni üretir, hidrasyon uyuşmazlığı olmaz. "Şimdi" okuması burada YOK (bkz. `clock.ts`).
 */

export type FormatDateInput = string | number | Date;

const TR_LOCALE = "tr-TR";
const TR_TIME_ZONE = "Europe/Istanbul";

// ---------------------------------------------------------------------------
// Para
// ---------------------------------------------------------------------------

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(currency: string): Intl.NumberFormat {
  let f = currencyFormatters.get(currency);
  if (!f) {
    f = new Intl.NumberFormat(TR_LOCALE, { style: "currency", currency, maximumFractionDigits: 0 });
    currencyFormatters.set(currency, f);
  }
  return f;
}

/** Kuruşsuz para birimi biçimi ("₺1.234"). Bozuk girdiyi olduğu gibi Intl'e verir. */
export function formatTry(amount: number): string {
  return currencyFormatter("TRY").format(amount);
}

const kurusFormatter = new Intl.NumberFormat(TR_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Kuruşlu ₺, sembol sonda ("1.494,00 ₺"). Hesap kredisi/fatura tutarları için (try-credits/view.ts `formatTry` takma adı). */
export function formatTryKurus(n: number): string {
  return `${kurusFormatter.format(n)} ₺`;
}

/** `formatTry` ile aynı, ama sonlu olmayan sayı 0 sayılır (hesaplayıcı çıktıları). */
export function formatTrySafe(n: number): string {
  return currencyFormatter("TRY").format(Number.isFinite(n) ? n : 0);
}

/** Kuruşsuz ₺ — para birimi sembolü sonda, boş/bozuk değer "—" ("1.234 ₺"). */
export function formatTryAmount(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${new Intl.NumberFormat(TR_LOCALE, { maximumFractionDigits: 0 }).format(Math.round(v))} ₺`;
}

/** Sembol sonda, en çok `maxFractionDigits` ondalık ("1.234,5 ₺"). */
export function formatTryDecimal(n: number, maxFractionDigits = 2): string {
  return `${new Intl.NumberFormat(TR_LOCALE, { maximumFractionDigits: maxFractionDigits }).format(n)} ₺`;
}

/** Sembolsüz Türkçe sayı ("1.234.567"). */
export function formatNumberTr(value: number): string {
  return new Intl.NumberFormat(TR_LOCALE).format(value);
}

/** Seçili para biriminde kuruşsuz tutar; boşsa "—" (fiyat geçmişi). */
export function formatMoney(amount: number | null | undefined, currency: "TRY" | "USD" | "EUR"): string {
  if (amount === null || amount === undefined) return "—";
  return currencyFormatter(currency).format(amount);
}

/**
 * Portföy ilan fiyatı: "1.234 ₺" (+ kiralıkta "/ay"). Fiyat yoksa `emptyLabel`.
 */
export function formatListingPrice(
  value: number | null,
  transaction: string,
  emptyLabel = "Fiyat girilmedi",
): string {
  if (value === null) return emptyLabel;
  const price = new Intl.NumberFormat(TR_LOCALE, { maximumFractionDigits: 0 }).format(value);
  return `${price} ₺${transaction === "rent" || transaction === "Kiralık" ? "/ay" : ""}`;
}

// ---------------------------------------------------------------------------
// Tarih (Türkiye saat dilimi)
// ---------------------------------------------------------------------------

/** Varsayılan tarih biçimi: "05 Eki 2026". */
const DEFAULT_DATE: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" };
/** Varsayılan tarih+saat biçimi: "5 Eki 2026 14:30". */
const DEFAULT_DATETIME: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };

function trFormat(value: FormatDateInput, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(TR_LOCALE, { timeZone: TR_TIME_ZONE, ...options }).format(new Date(value));
}

/** Türkiye saatiyle tarih. `options` Intl.DateTimeFormat seçenekleridir. */
export function formatDateTr(value: FormatDateInput, options: Intl.DateTimeFormatOptions = DEFAULT_DATE): string {
  return trFormat(value, options);
}

/** Türkiye saatiyle tarih + saat. */
export function formatDateTimeTr(
  value: FormatDateInput,
  options: Intl.DateTimeFormatOptions = DEFAULT_DATETIME,
): string {
  return trFormat(value, options);
}
