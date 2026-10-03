/**
 * Yeni destek talebi formunun sekme tanımı (veri: ikon yok) — form bileşeni ve
 * `src/lib/form-tabs-contract.test.ts` aynı kaynağı kullanır.
 * Not: dosya girişi (`files`) ayrı bileşende (TicketAttachmentInput) olduğundan burada listelenmez.
 */
export const TICKET_FORM_ID = "yeni-destek-talebi";

export const TICKET_TABS = [
  {
    id: "talep",
    label: "Talep bilgisi",
    description: "Konu, kategori ve öncelik destek ekibinin yönlendirmesi için kullanılır.",
    fields: ["request_id", "subject", "category", "priority"],
    required: ["subject"],
  },
  {
    id: "aciklama",
    label: "Açıklama ve ekler",
    description: "Sorunu, beklenen sonucu ve denediğiniz adımları paylaşın; ekran görüntüsü veya belge ekleyebilirsiniz.",
    fields: ["body"],
    required: ["body"],
  },
] as const;

/** Taslağa yazılabilen alanlar: yalnız kategori/öncelik seçimi (konu ve açıklama hassas olabilir; YOK). */
export const TICKET_DRAFT_FIELDS = ["category", "priority"] as const;
