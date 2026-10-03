/**
 * Yeni kira kaydı formunun sekme tanımı (veri: ikon yok) — form bileşeni ve
 * `src/lib/form-tabs-contract.test.ts` aynı kaynağı kullanır.
 */
export const RENTAL_FORM_ID = "yeni-kira";

export const RENTAL_TABS = [
  {
    id: "taraflar",
    label: "Taraflar",
    description: "Kiralanan portföy ve kiracı müşteri.",
    fields: ["property_id", "renter_customer_id"],
    required: ["property_id", "renter_customer_id"],
  },
  {
    id: "bedel",
    label: "Bedel ve vade",
    description: "Aylık kira, ödeme günü ve depozito.",
    fields: ["monthly_rent", "due_day", "deposit"],
    required: ["monthly_rent", "due_day"],
  },
  {
    id: "sure",
    label: "Süre ve notlar",
    description: "Sözleşme dönemi ve özel koşullar.",
    fields: ["start_date", "end_date", "notes"],
    required: ["start_date"],
  },
] as const;

/** Taslağa yalnız vade günü (tutar ?tutar ön dolgusunu ezmesin; not YOK). */
export const RENTAL_DRAFT_FIELDS = ["due_day"] as const;
