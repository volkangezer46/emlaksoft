/**
 * Ana sayfa kart tonları: yönetici yalnız bu KAPALI listeden seçer; serbest renk veya sınıf adı girilemez.
 * Her ton koda STATİK yazılmış tek bir sınıfa eşlenir (marketing.css'teki `.mk-tint-*`); statik ana sayfa dönüşümü
 * kullanılan sınıfları tanısın diye sınıf adları burada tam yazılır (birleştirilerek üretilmez). Saf modül.
 */
export const CARD_TONES = ["brand", "emerald", "amber", "violet", "rose"] as const;
export type CardTone = (typeof CARD_TONES)[number];

export const TONE_LABEL: Record<CardTone, string> = {
  brand: "Mavi (marka)",
  emerald: "Yeşil",
  amber: "Kehribar",
  violet: "Lacivert",
  rose: "Gül",
};

const TONE_CLASS: Record<CardTone, string> = {
  brand: "mk-tint-blue",
  emerald: "mk-tint-mint",
  amber: "mk-tint-amber",
  violet: "mk-tint-violet",
  rose: "mk-tint-rose",
};

export function isCardTone(value: unknown): value is CardTone {
  return typeof value === "string" && (CARD_TONES as readonly string[]).includes(value);
}

/** Tonun sınıfı; bilinmeyen/boş değer `fallback` tonuna düşer (bozuk kayıt serbest sınıf üretemez). */
export function toneClass(tone: unknown, fallback: CardTone = "brand"): string {
  return TONE_CLASS[isCardTone(tone) ? tone : fallback];
}
