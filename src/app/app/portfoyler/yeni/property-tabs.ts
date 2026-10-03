/**
 * Yeni portföy formunun sekme tanımı (veri: ikon yok) — form bileşeni ve
 * `src/lib/form-tabs-contract.test.ts` aynı kaynağı kullanır. Yeni alan eklersen
 * hem formda hem burada (fields) olmalı; sözleşme testi eşitliği doğrular.
 * "Ek bilgi" sekmesi alan içermez: yalnız sonraki adımları anlatır.
 */
export const PROPERTY_FORM_ID = "yeni-portfoy";

export const PROPERTY_TABS = [
  {
    id: "temel",
    label: "Temel",
    description: "İlanın başlığı ve türü.",
    fields: ["title", "transaction_type", "property_type", "rooms", "sqm", "branch_id"],
    required: ["title", "transaction_type", "property_type"],
  },
  {
    id: "konum",
    label: "Konum",
    description: "İl, ilçe, mahalle ve harita noktası emsal analizini besler.",
    fields: ["province_id", "district_id", "neighborhood_id", "address_line", "lat", "lng"],
    required: [],
  },
  {
    id: "fiyat",
    label: "Fiyat ve komisyon",
    description: "Liste fiyatı ve anlaşılan komisyon oranı.",
    fields: ["list_price", "commission_rate"],
    required: ["list_price", "commission_rate"],
  },
  {
    id: "ozellikler",
    label: "Özellikler",
    description: "Kat, ısınma, bina yaşı ve tapu bilgileri (isteğe bağlı).",
    fields: ["floor", "heating", "building_age", "facade", "parcel_block", "parcel_lot"],
    required: [],
  },
  {
    id: "ek",
    label: "Ek bilgi",
    description: "Portföy taslak olarak açılır; kalan adımlar detay sayfasında tamamlanır.",
    fields: [],
    required: [],
  },
] as const;

/** Taslağa yazılabilen alanlar: hassas olmayan, kontrolsüz alanlar (adres, parsel, harita YOK). */
export const PROPERTY_DRAFT_FIELDS = [
  "title",
  "transaction_type",
  "property_type",
  "rooms",
  "sqm",
  "branch_id",
  "list_price",
  "commission_rate",
  "floor",
  "heating",
  "building_age",
  "facade",
] as const;
