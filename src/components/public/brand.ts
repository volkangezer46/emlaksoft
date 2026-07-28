/**
 * Vitrin/portal yüzünün marka katmanı.
 *
 * Kiracının `tenants.brand_color` değeri public sayfalarda arka plan olarak
 * kullanılıyordu ve üstüne KOŞULSUZ beyaz metin yazılıyordu. Açık tonlu bir
 * marka rengi seçen ofiste (ör. #F5C518 sarı) beyaz metnin kontrastı 1.8:1'e
 * kadar düşüyor — WCAG AA (4.5:1) çok altı. Burada renk bir kez normalize
 * edilir, üstüne yazılacak metin rengi ÖLÇÜLEREK seçilir ve sonuç CSS
 * değişkeni olarak taşınır; böylece her sayfa aynı kararı tekrar vermez.
 *
 * globals.css'e sınıf eklemek yasak olduğu için taşıyıcı, inline style ile
 * verilen custom property'ler: bileşenler `var(--pb-*)` okur.
 */

/** Marka rengi girilmemiş kiracılar için ürün mavisi (Brand #1463FF). */
export const BRAND_FALLBACK = "#1463FF";
/** Marka üstünde beyaz yeterli değilse kullanılacak koyu metin (Ink). */
const INK = "#071A38";

/** `#abc` / `#aabbcc` / `aabbcc` → `#aabbcc`; geçersizse null. */
export function normalizeBrandColor(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  const hex = raw.startsWith("#") ? raw.slice(1) : raw;
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    const [r, g, b] = hex.toLowerCase().split("") as [string, string, string];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex.toLowerCase()}`;
  return null;
}

function toRgb(hex: string): [number, number, number] {
  const h = hex.slice(1);
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** WCAG 2.x bağıl parlaklık. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** İki renk arasındaki WCAG kontrast oranı (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Marka renginin ÜSTÜNE yazılacak metin rengi — beyaz ile Ink arasından
 * kontrastı yüksek olanı seçer. Eşit durumda beyaz (marka algısı) kazanır.
 */
export function onBrandTextColor(hex: string): string {
  return contrastRatio(hex, "#ffffff") >= contrastRatio(hex, INK) ? "#ffffff" : INK;
}

/** Marka rengi metin/ikon olarak beyaz zeminde okunaklı mı? (AA, 4.5:1) */
export function isBrandReadableOnLight(hex: string): boolean {
  return contrastRatio(hex, "#ffffff") >= 4.5;
}

/**
 * Marka rengini metin/ikon olarak kullanılabilir hale getirir: beyaz zeminde
 * AA'yı geçene kadar karartır. Sarı/açık yeşil marka renkleri "ince ikon"
 * olarak kullanıldığında görünmez oluyordu.
 */
export function readableBrandInk(hex: string): string {
  let [r, g, b] = toRgb(hex);
  // En fazla 24 adım — her adımda %8 karart. Yakınsamazsa Ink'e düşer.
  for (let i = 0; i < 24; i++) {
    const cur = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    if (contrastRatio(cur, "#ffffff") >= 4.5) return cur;
    r = Math.round(r * 0.92);
    g = Math.round(g * 0.92);
    b = Math.round(b * 0.92);
  }
  return INK;
}

export type BrandTheme = {
  /** Ham marka rengi (dolu zeminler için). */
  brand: string;
  /** Marka üstündeki metin — kontrast ölçülerek seçilmiş. */
  onBrand: string;
  /** Metin/ikon olarak güvenli marka tonu (beyaz zeminde AA). */
  ink: string;
  /** Bileşenlere geçirilecek inline CSS değişkenleri. */
  style: React.CSSProperties;
  /** Kiracı gerçekten kendi rengini seçmiş mi (yoksa ürün mavisi mi)? */
  custom: boolean;
};

/**
 * Bir kiracının marka temasını üretir. Dönen `style` en dış kapsayıcıya
 * verilir; alt bileşenler `var(--pb-brand)` / `var(--pb-on-brand)` /
 * `var(--pb-ink)` / `var(--pb-tint)` / `var(--pb-veil)` okur.
 *
 * `--pb-tint`: çok hafif marka degradesi (hero zemini). Okunabilirliği
 * bozmasın diye opaklık 0.10'u geçmez.
 */
export function brandTheme(input: string | null | undefined): BrandTheme {
  const normalized = normalizeBrandColor(input);
  const brand = normalized ?? BRAND_FALLBACK;
  const onBrand = onBrandTextColor(brand);
  const ink = readableBrandInk(brand);
  return {
    brand,
    onBrand,
    ink,
    custom: normalized != null,
    style: {
      "--pb-brand": brand,
      "--pb-on-brand": onBrand,
      "--pb-ink": ink,
      // 6 / 10 / 18 / 40 → yaklaşık %4 / %6 / %9 / %25 opaklık
      "--pb-veil": `${brand}0f`,
      "--pb-soft": `${brand}1a`,
      "--pb-edge": `${brand}40`,
      "--pb-tint": `linear-gradient(160deg, ${brand}14 0%, ${brand}08 38%, transparent 72%)`,
    } as React.CSSProperties,
  };
}
