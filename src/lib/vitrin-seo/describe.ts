import type { SeoPatternVars } from "@/lib/seo/patterns";

/**
 * İlan SEO değişkenleri ve gerçek özellikli kısa tanım (SAF). Ham adres alanı (`address_line`, ör. "… — demo adres")
 * başlık/açıklama/JSON-LD açıklamasına GİRMEZ: tanım yalnız ilçe, işlem, tip, oda, m² ve fiyattan üretilir.
 * `konum` değişkeni yönetici kalıpları için korunur (geri uyum) ama varsayılan kalıplar onu kullanmaz.
 */

export type ListingFacts = {
  title: string | null | undefined;
  code?: string | null;
  office: string | null | undefined;
  priceText: string | null | undefined;
  province?: string | null;
  district?: string | null;
  tx?: string | null;
  type?: string | null;
  rooms?: string | null;
  sqm?: number | string | null;
  /** Yalnız `konum` (yönetici kalıbı) için; varsayılan çıktıya girmez. */
  addressLine?: string | null;
};

const txt = (v: unknown): string => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());

/** m² sayısı → "120 m²" (geçersiz/0 → null). */
export function sqmText(sqm: number | string | null | undefined): string | null {
  const n = typeof sqm === "number" ? sqm : Number(String(sqm ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n)} m²`;
}

/** resolveSeoPattern(…, "listing", …) için değişkenler. */
export function listingSeoVars(f: ListingFacts): SeoPatternVars {
  const loc = [f.addressLine, f.district, f.province].map(txt).filter(Boolean).join(", ");
  return {
    ofis: txt(f.office) || null,
    ilan_basligi: txt(f.title) || txt(f.code) || null,
    fiyat: txt(f.priceText) || null,
    il: txt(f.province) || null,
    ilce: txt(f.district) || null,
    konum: loc || "Türkiye",
    islem: txt(f.tx) || null,
    tip: txt(f.type) || null,
    oda: txt(f.rooms) || null,
    metrekare: sqmText(f.sqm),
  };
}

/**
 * Kullanıcı açıklaması yokken kullanılan gerçek özellikli tanım (JSON-LD `description` yedeği):
 * "Kadıköy Satılık Daire · 3+1 · 120 m² · 5.000.000 ₺". Hiçbir özellik yoksa null.
 */
export function listingFactLine(f: ListingFacts): string | null {
  const head = [f.district ?? f.province, f.tx, f.type].map(txt).filter(Boolean).join(" ");
  const parts = [head, txt(f.rooms), sqmText(f.sqm) ?? "", txt(f.priceText)].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
