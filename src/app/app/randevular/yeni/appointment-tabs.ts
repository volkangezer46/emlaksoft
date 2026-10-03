/**
 * Yeni randevu formunun sekme tanımı (veri: ikon yok) — form bileşeni ve
 * `src/lib/form-tabs-contract.test.ts` aynı kaynağı kullanır.
 * `confirm_conflict`: çakışma uyarı bandındaki gizli onay alanı (sekmeden bağımsız, yalnız çakışmada render edilir).
 */
export const APPOINTMENT_FORM_ID = "yeni-randevu";

export const APPOINTMENT_TABS = [
  {
    id: "zaman",
    label: "Zaman",
    description: "Randevunun türü, günü ve süresi.",
    fields: ["appointment_type", "duration_min", "date", "time", "confirm_conflict"],
    required: ["appointment_type", "date", "time"],
  },
  {
    id: "katilimci",
    label: "Katılımcılar ve yer",
    description: "Müşteri ve portföy yazarak aranır (Türkçe karakter duyarsız).",
    fields: ["customer_id", "property_id", "location", "notes"],
    required: [],
  },
] as const;

/** Taslağa yalnız hassas olmayan, kontrolsüz seçimler (tarih/saat ?tarih ?saat ön dolgusunu ezmesin; not YOK). */
export const APPOINTMENT_DRAFT_FIELDS = ["appointment_type", "duration_min"] as const;
