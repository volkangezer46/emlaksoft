/**
 * Talep kriteri anahtarları ve Türkçe etiketleri — TEK KAYNAK (`demand-criteria.ts` buradan yeniden dışa aktarır).
 *
 * NEDEN AYRI DOSYA: `demand-criteria.ts` modül düzeyinde zod şemaları kurar; istemci bileşeni yalnız bu
 * etiketler için onu içe aktarınca tüm zod paketi (~280 KB ham) tarayıcıya iner (form kabuğu
 * `form-field-labels` üzerinden 28 form sayfası etkileniyordu). Bu dosya bağımlılıksızdır; buraya
 * zod/sunucu içe aktarması EKLEME (`src/lib/client-bundle-contract.test.ts`).
 */

/** "Olmazsa olmaz" işaretlenebilen kriter anahtarları. */
export const CRITERIA_REQUIRED_KEYS = [
  "property_type",
  "budget",
  "rooms",
  "sqm",
  "location",
  "floor",
  "heating",
  "facade",
  "features",
] as const;
export type CriteriaKey = (typeof CRITERIA_REQUIRED_KEYS)[number];

export const CRITERIA_LABELS: Record<CriteriaKey, string> = {
  property_type: "Portföy türü",
  budget: "Bütçe",
  rooms: "Oda",
  sqm: "m²",
  location: "Konum",
  floor: "Kat",
  heating: "Isınma",
  facade: "Cephe",
  features: "Özellikler",
};
