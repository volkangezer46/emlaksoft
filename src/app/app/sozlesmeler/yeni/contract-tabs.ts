/**
 * Yeni sözleşme formunun sekme tanımı (veri: ikon yok) — form bileşeni ve
 * `src/lib/form-tabs-contract.test.ts` aynı kaynağı kullanır.
 * `customer_id` / `property_id` yalnız teklif/randevu akışından gelen gizli ön dolgudur.
 */
export const CONTRACT_FORM_ID = "yeni-sozlesme";

export const CONTRACT_TABS = [
  {
    id: "bilgiler",
    label: "Sözleşme bilgileri",
    description: "Başlık, tür ve (varsa) son geçerlilik tarihi.",
    fields: ["title", "contract_type", "expires_at", "customer_id", "property_id"],
    required: ["title"],
  },
  {
    id: "icerik",
    label: "İçerik",
    description: "Metni yazın veya türe uygun şablonu uygulayın.",
    fields: ["body"],
    required: ["body"],
  },
] as const;

/** Yalnız kontrolsüz (native) ve hassas olmayan alanlar; metin (body) ve tür (kontrollü) yok. */
export const CONTRACT_DRAFT_FIELDS = ["title", "expires_at"] as const;
