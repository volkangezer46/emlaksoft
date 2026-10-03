/**
 * Yeni talep formunun sekme tanımı (veri: ikon yok) — form bileşeni ve
 * `src/lib/form-tabs-contract.test.ts` aynı kaynağı kullanır. Yeni alan eklersen
 * hem formda hem burada (fields) olmalı; sözleşme testi eşitliği doğrular.
 */
export const DEMAND_FORM_ID = "yeni-talep";

export const DEMAND_TABS = [
  {
    id: "musteri",
    label: "Müşteri ve işlem",
    description: "Talebin sahibi ve ne aradığı.",
    fields: ["customer_id", "transaction_type", "property_type", "urgency"],
    required: ["customer_id", "transaction_type"],
  },
  {
    id: "kriter",
    label: "Bütçe ve kriter",
    description: "Eşleştirme motoru bu değerlerle portföyleri önerir.",
    fields: ["budget_min", "budget_max", "rooms", "min_sqm"],
    required: [],
  },
  {
    id: "bolge",
    label: "Bölge",
    description: "Eşleştirme motoru portföy ilçesi ile talep ilçesini karşılaştırır; ilçe seçmek sonucu keskinleştirir.",
    fields: ["province_id", "district_id", "neighborhood_id"],
    required: [],
  },
] as const;

/**
 * Taslağa yazılabilen alanlar: yalnız kontrolsüz (native) ve hassas olmayan seçim/sayılar.
 * `customer_id` bilinçli YOK: müşteri-360 girişinde sabit gizli alandır, taslak onu ezmemeli.
 * Bölge (GeoSelect) kontrollü bileşen olduğu için yok.
 */
export const DEMAND_DRAFT_FIELDS = [
  "transaction_type",
  "property_type",
  "urgency",
  "budget_min",
  "budget_max",
  "rooms",
  "min_sqm",
] as const;
