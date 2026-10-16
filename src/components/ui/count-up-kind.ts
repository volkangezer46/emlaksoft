/**
 * CountUp animasyon sınıfı — bağımlılıksız, sunucu ve istemci ortak. Sunucu bileşenleri (ör. KPI kartı) para ve adet
 * değerlerini istemci sayacına hiç göndermeden düz metin çizer (animasyonları zaten kapalı); yalnız oran / ondalık
 * ("other") değerler tembel sayacı (`count-up-lazy`) bağlar.
 */
export type CountUpFormat = "number" | "money" | "percent";

export type CountUpKind = "money" | "count" | "other";

const COUNT_RE = /^(\d{1,3}(?:\.\d{3})+|\d+)$/;

/** Animasyon sınıfı: para ve adet KPI'larında animasyon kapalıdır. */
export function countUpKind(value: string | number, format: CountUpFormat | undefined, decimals: number, prefix = "", suffix = ""): CountUpKind {
  if (format === "money") return "money";
  if (typeof value === "string") {
    if (/₺|\bTL\b/.test(value) || /₺|\bTL\b/.test(prefix + suffix)) return "money";
    return COUNT_RE.test(value.trim()) && !prefix && !suffix ? "count" : "other";
  }
  if ((format === undefined || format === "number") && decimals === 0 && Number.isInteger(value) && !prefix && !suffix) return "count";
  return "other";
}

const moneyNf = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });

/** CountUp `format="money"` metni (₺ tam sayı). Para animasyonu kapalı olduğundan sunucu bileşeni bunu düz çizer. */
export function countUpMoneyText(n: number): string {
  return moneyNf.format(Math.round(n));
}
