/**
 * Yeni onay talebi formunun sekme tanımı (veri: ikon yok) — form bileşeni ve
 * `src/lib/form-tabs-contract.test.ts` aynı kaynağı kullanır.
 */
export const APPROVAL_FORM_ID = "yeni-onay";

export const APPROVAL_TABS = [
  {
    id: "talep",
    label: "Talep",
    description: "Talep türüne göre değer alanlarının birimi (% / ₺) değişir.",
    fields: ["kind", "title", "current_value", "requested_value"],
    required: ["kind", "title"],
  },
  {
    id: "kayit",
    label: "Kayıt ve gerekçe",
    description: "İlgili anlaşma/gider (isteğe bağlı) ve kararı destekleyen gerekçe.",
    fields: ["entity_type", "entity_id", "description"],
    required: [],
  },
] as const;

/** Taslağa yazılabilen alanlar: yalnız kontrolsüz sayısal değerler (başlık/gerekçe YOK; tür kontrollü). */
export const APPROVAL_DRAFT_FIELDS = ["current_value", "requested_value"] as const;
