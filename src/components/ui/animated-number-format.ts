/**
 * AnimatedNumber biçim mantığı (saf; sunucu + istemci aynı metni üretir → hidrasyon uyuşmazlığı yok).
 * tr-TR `Intl.NumberFormat`: sayı ("1.234"), para ("₺1.234"), yüzde ("%12").
 */
export type AnimatedNumberKind = "number" | "currency" | "percent";

export type AnimatedNumberFormat = {
  /** Varsayılan "number". "percent": değer YÜZDE biriminde verilir (12 → "%12"). */
  kind?: AnimatedNumberKind;
  /** `kind="currency"` için para birimi (varsayılan TRY → "₺1.234"). */
  currency?: "TRY" | "USD" | "EUR" | "GBP";
  /** Varsayılan 0 (kuruşsuz / tam sayı). */
  maximumFractionDigits?: number;
  /** Sayının önüne/arkasına eklenen sabit metin (ör. `suffix=" ₺"` → "1.234 ₺"). */
  prefix?: string;
  suffix?: string;
};

export const ANIMATED_NUMBER_LOCALE = "tr-TR";

export function animatedNumberOptions(f: AnimatedNumberFormat): Intl.NumberFormatOptions {
  const maximumFractionDigits = f.maximumFractionDigits ?? 0;
  if (f.kind === "currency") return { style: "currency", currency: f.currency ?? "TRY", maximumFractionDigits };
  if (f.kind === "percent") return { style: "percent", maximumFractionDigits };
  return { maximumFractionDigits };
}

/** NumberFlow / Intl'e verilecek ham değer: sonlu değilse 0; yüzde birimi orana çevrilir. */
export function animatedNumberValue(value: number, kind: AnimatedNumberKind | undefined): number {
  const v = Number.isFinite(value) ? value : 0;
  return kind === "percent" ? v / 100 : v;
}

/** Düz metin yedeği (sunucu, ilk boyama, hareket azaltma, parça inmeden önce). */
export function formatAnimatedNumber(value: number, f: AnimatedNumberFormat = {}): string {
  const text = new Intl.NumberFormat(ANIMATED_NUMBER_LOCALE, animatedNumberOptions(f)).format(
    animatedNumberValue(value, f.kind),
  );
  return `${f.prefix ?? ""}${text}${f.suffix ?? ""}`;
}
