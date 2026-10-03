/**
 * Yeni açık ev günü formunun sekme tanımı (veri: ikon yok) — form bileşeni ve
 * `src/lib/form-tabs-contract.test.ts` aynı kaynağı kullanır.
 */
export const OPEN_HOUSE_FORM_ID = "yeni-acik-ev";

export const OPEN_HOUSE_TABS = [
  {
    id: "zaman",
    label: "Portföy ve zaman",
    description: "Etkinliğin yapılacağı portföyü ve zamanı seçin.",
    fields: ["property_id", "scheduled_at", "duration_min"],
    required: ["property_id", "scheduled_at"],
  },
  {
    id: "yer",
    label: "Yer ve kapasite",
    description: "Buluşma noktası ve ziyaretçi sınırı.",
    fields: ["location", "max_visitors"],
    required: [],
  },
  {
    id: "not",
    label: "Not",
    description: "Hazırlık listesi, broşür, ikram gibi notlar.",
    fields: ["notes"],
    required: [],
  },
] as const;

/** Taslağa yalnız süre ve kapasite (not/konum YOK). */
export const OPEN_HOUSE_DRAFT_FIELDS = ["duration_min", "max_visitors"] as const;
