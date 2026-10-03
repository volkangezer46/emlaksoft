/**
 * Yeni proje formunun sekme tanımı (veri: ikon yok) — form bileşeni ve
 * `src/lib/form-tabs-contract.test.ts` aynı kaynağı kullanır.
 */
export const PROJECT_FORM_ID = "yeni-proje";

export const PROJECT_TABS = [
  {
    id: "proje",
    label: "Proje",
    description: "Proje adı zorunludur; blok ve daireleri kayıttan sonra detay ekranından eklersiniz.",
    fields: ["name", "developer_name", "status"],
    required: ["name"],
  },
  {
    id: "konum",
    label: "Konum ve teslim",
    description: "Konum ve tahmini teslim tarihi listelerde ve raporlarda görünür.",
    fields: ["location", "delivery_date"],
    required: [],
  },
  {
    id: "aciklama",
    label: "Açıklama",
    description: "Proje hakkında kısa not.",
    fields: ["description"],
    required: [],
  },
] as const;

/** Taslağa yazılabilen alanlar: yalnız hassas olmayan, kontrolsüz seçimler/metinler (açıklama YOK). */
export const PROJECT_DRAFT_FIELDS = ["developer_name", "location", "delivery_date", "status"] as const;
