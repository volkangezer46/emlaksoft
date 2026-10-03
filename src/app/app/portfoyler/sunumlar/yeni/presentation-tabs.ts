/**
 * Yeni portföy sunumu formunun sekme tanımı (veri: ikon yok) — form bileşeni ve
 * `src/lib/form-tabs-contract.test.ts` aynı kaynağı kullanır.
 * `property_ids`: seçilen portföyler için gizli input'lar (en az 1, en çok 5).
 * Form kontrollü alanlardan oluşur; taslak yok (başarıda sayfa değişmez, link kartı gösterilir).
 */
export const PRESENTATION_FORM_ID = "yeni-sunum";

export const PRESENTATION_TABS = [
  {
    id: "bilgi",
    label: "Sunum bilgileri",
    description: "Başlık, müşteri ve kapak notu.",
    fields: ["title", "customer_name", "customer_id", "note"],
    required: ["title"],
  },
  {
    id: "portfoyler",
    label: "Portföyler",
    description: "Yayında olan portföylerden en fazla 5 tanesini seçin.",
    fields: ["property_ids"],
    required: ["property_ids"],
  },
] as const;

export const PRESENTATION_DRAFT_FIELDS = [] as const;
