/**
 * Terim sözlüğü (B193) — ürünün tek dili. Ekranda aynı kavram için tek kelime kullanılır:
 *  - Ofisin kendi kaydı = "Portföy" (kodu "portföy kodu"). Portaldaki karşılığı = "İlan" / "ilan no" (dış numara;
 *    yalnız portal bağlamında: ilan kontrolü, eşleşme). Kendi kaydı için "ilan" denmez.
 *  - Satış süreci kaydı = "Anlaşma". "Fırsat" kullanılmaz.
 *  - Kişi = "Müşteri"; aradığı ev = "Talep". "Lead" kullanılmaz.
 * Saf modül; yeni metin yazarken buradaki adlar kullanılır.
 */
export const TERMS = {
  property: "Portföy",
  properties: "Portföyler",
  propertyCode: "portföy kodu",
  listing: "İlan",
  listingNo: "ilan no",
  deal: "Anlaşma",
  deals: "Anlaşmalar",
  openDeals: "Açık anlaşma",
  customer: "Müşteri",
  customers: "Müşteriler",
  demand: "Talep",
  demands: "Talepler",
} as const;

/** Kendi kayıt bağlamında yasak kalıplar (sözleşme testi kendi dosyalarında tarar). */
export const FORBIDDEN_TERMS: readonly RegExp[] = [/\bfırsat/i, /\bYeni ilan\b/, /\bİlanın\b/];
