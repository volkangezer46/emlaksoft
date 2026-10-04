/**
 * Ofis adına yeni destek talebi formunun sekme tanımı (veri: ikon yok) — form bileşeni ve
 * `src/lib/form-tabs-contract.test.ts` aynı kaynağı kullanır.
 */
export const ADMIN_TICKET_FORM_ID = "yeni-admin-destek-talebi";

export const ADMIN_TICKET_TABS = [
  {
    id: "talep",
    label: "Ofis ve talep",
    description: "Talebin açılacağı ofis, konu, kategori ve öncelik. Talep ofis adına açılır.",
    fields: ["request_id", "tenant_id", "subject", "category", "priority"],
    required: ["tenant_id", "subject"],
  },
  {
    id: "aciklama",
    label: "Açıklama",
    description: "Sorunu, beklenen sonucu ve bilinen ayrıntıları yazın.",
    fields: ["body"],
    required: ["body"],
  },
] as const;

/** Talep metni kişisel/hassas olabilir; taslak kullanılmaz. */
export const ADMIN_TICKET_DRAFT_FIELDS = [] as const;
