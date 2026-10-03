/**
 * Yeni görev formunun sekme tanımı (veri: ikon yok) — form bileşeni ve
 * `src/lib/form-tabs-contract.test.ts` aynı kaynağı kullanır.
 */
export const TASK_FORM_ID = "yeni-gorev";

export const TASK_TABS = [
  {
    id: "gorev",
    label: "Görev",
    description: "Ne yapılacak, hangi türde ve ne kadar acil.",
    fields: ["title", "kind", "priority", "notes"],
    required: ["title"],
  },
  {
    id: "zamanlama",
    label: "Zamanlama ve atama",
    description: "Son tarih, tekrar ve sorumlu kişi.",
    fields: ["due_at", "recurrence", "assigned_to", "customer_id"],
    required: [],
  },
] as const;

/** Taslağa yalnız hassas olmayan, kontrolsüz seçimler (başlık/not YOK; son tarih kontrollü). */
export const TASK_DRAFT_FIELDS = ["kind", "priority"] as const;
