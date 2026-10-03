/**
 * Yeni anlaşma formunun sekme tanımı (veri: ikon yok) — form bileşeni ve
 * `src/lib/form-tabs-contract.test.ts` aynı kaynağı kullanır.
 */
export const DEAL_FORM_ID = "yeni-anlasma";

export const DEAL_TABS = [
  {
    id: "taraflar",
    label: "Taraflar",
    description: "Müzakere aşaması için portföy ve müşteri zorunludur.",
    fields: ["property_id", "customer_id"],
    required: [],
  },
  {
    id: "detay",
    label: "Anlaşma detayı",
    description: "Tür, aşama, tutar ve yetki durumu.",
    fields: ["deal_type", "stage", "deal_value", "has_authority"],
    required: [],
  },
] as const;

/** Yalnız kontrolsüz (native) ve hassas olmayan alanlar; aşama/yetki/Combobox kontrollüdür, yok. */
export const DEAL_DRAFT_FIELDS = ["deal_type", "deal_value"] as const;
