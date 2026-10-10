import { DEMAND_FIELD_GROUPS } from "@/lib/demand-criteria";

/**
 * Yeni talep formunun sekme tanımı (veri: ikon yok) — form bileşeni ve
 * `src/lib/form-tabs-contract.test.ts` aynı kaynağı kullanır. Yeni alan eklersen
 * hem formda hem burada (fields) olmalı; sözleşme testi eşitliği doğrular.
 *
 * Talep alanlarının adları `src/lib/demand-criteria.ts` DEMAND_FIELD_GROUPS'tan gelir
 * (müşteri formundaki "Talep ve kriterler" sekmesiyle TEK kaynak); alanların kendisi
 * `StructuredDemandFields` ortak bileşenindedir.
 */
export const DEMAND_FORM_ID = "yeni-talep";

export const DEMAND_TABS = [
  {
    id: "musteri",
    label: "Müşteri ve işlem",
    description: "Talebin sahibi ve ne aradığı.",
    fields: ["customer_id", ...DEMAND_FIELD_GROUPS.ne],
    required: ["customer_id", "transaction_type"],
  },
  {
    id: "kriter",
    label: "Bütçe ve kriter",
    description: "Akıllı eşleştirme bu değerlerle portföyleri önerir; işaretlediğiniz kriterler olmazsa olmaz sayılır.",
    fields: [...DEMAND_FIELD_GROUPS.kriter],
    required: [],
  },
  {
    id: "bolge",
    label: "Bölge",
    description: "Birden fazla il/ilçe/mahalle seçebilirsiniz; ilçe seçmek sonucu keskinleştirir.",
    fields: [...DEMAND_FIELD_GROUPS.bolge],
    required: [],
  },
] as const;

/**
 * Taslağa yazılabilen alanlar: yalnız kontrolsüz (native) ve hassas olmayan seçim/sayılar.
 * `customer_id` bilinçli YOK: müşteri-360 girişinde sabit gizli alandır, taslak onu ezmemeli.
 * Bölge (GeoSelect) ve gizli birleşik alanlar (required_keys, extra_locations) kontrollü olduğu için yok.
 */
export const DEMAND_DRAFT_FIELDS = [
  "transaction_type",
  "property_type",
  "urgency",
  "budget_min",
  "budget_max",
  "rooms",
  "min_sqm",
  "max_sqm",
  "floor_min",
  "floor_max",
  "heating",
  "facade",
] as const;
