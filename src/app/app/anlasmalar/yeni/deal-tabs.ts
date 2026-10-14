/**
 * Yeni anlaşma formunun sekme tanımı (veri: ikon yok) — form bileşeni ve
 * `src/lib/form-tabs-contract.test.ts` aynı kaynağı kullanır.
 */
import { hasValue, type FormRuleIssue } from "@/lib/form-rules";

export const DEAL_FORM_ID = "yeni-anlasma";

export const DEAL_TABS = [
  {
    id: "taraflar",
    label: "Taraflar",
    description: "Müşteri ya da portföyden en az biri zorunlu; müzakere aşaması için ikisi de.",
    fields: ["property_id", "customer_id"],
    required: [],
  },
  {
    id: "detay",
    label: "Anlaşma detayı",
    description: "Tür, aşama, tutar ve yetki durumu. Tutar zorunludur.",
    fields: ["deal_type", "stage", "deal_value", "has_authority"],
    required: [],
  },
] as const;

/** Yalnız kontrolsüz (native) ve hassas olmayan alanlar; aşama/yetki/Combobox kontrollüdür, yok. */
export const DEAL_DRAFT_FIELDS = ["deal_type", "deal_value"] as const;

/**
 * Boş anlaşma kuralı (istemci "N eksik" + sunucu `createPipelineDeal` ortak): müşteri ya da portföyden
 * en az biri ve tutar. Müzakere aşamasının ikisini birden isteyen kuralı sunucuda ayrıca uygulanır.
 */
export function dealMissing(values: {
  property_id?: string | null;
  customer_id?: string | null;
  deal_value?: string | null;
}): FormRuleIssue[] {
  const out: FormRuleIssue[] = [];
  if (!hasValue(values.property_id) && !hasValue(values.customer_id)) {
    out.push({ key: "party", label: "Müşteri ya da portföy", tab: "taraflar", field: "deal-property" });
  }
  if (!hasValue(values.deal_value)) out.push({ key: "value", label: "Tutar", tab: "detay", field: "deal_value" });
  return out;
}
