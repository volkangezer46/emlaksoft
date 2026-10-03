/**
 * Yeni teklif formunun sekme tanımı (veri: ikon yok) — form bileşeni ve
 * `src/lib/form-tabs-contract.test.ts` aynı kaynağı kullanır.
 */
export const OFFER_FORM_ID = "yeni-teklif";

export const OFFER_TABS = [
  {
    id: "taraflar",
    label: "Taraflar",
    description: "Teklifin yapıldığı portföy ve (varsa) müşteri.",
    fields: ["property_id", "customer_id"],
    required: ["property_id"],
  },
  {
    id: "kosullar",
    label: "Teklif koşulları",
    description: "Tutar, geçerlilik tarihi ve not.",
    fields: ["amount", "valid_until", "notes"],
    required: ["amount"],
  },
] as const;

/**
 * Yalnız kontrolsüz (native) ve hassas olmayan alanlar. `amount` yok: portföy değişince
 * liste fiyatıyla sıfırlanan (key'li) alandır; not hassas kabul edilir.
 */
export const OFFER_DRAFT_FIELDS = ["property_id", "customer_id", "valid_until"] as const;
