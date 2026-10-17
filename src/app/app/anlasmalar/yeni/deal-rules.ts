/**
 * Boş anlaşma kuralı — istemci (Satış sihirbazı, `satis-adimlar.ts`) ve sunucu (`createPipelineDeal`) ORTAK, saf.
 */
import { hasValue, type FormRuleIssue } from "@/lib/form-rules";

/**
 * Müşteri ya da portföyden en az biri ve tutar. Müzakere aşamasının ikisini birden isteyen kuralı sunucuda ayrıca
 * uygulanır. `tab` sihirbaz adım kimliği, `field` alanın DOM kimliğidir.
 */
export function dealMissing(values: {
  property_id?: string | null;
  customer_id?: string | null;
  deal_value?: string | null;
}): FormRuleIssue[] {
  const out: FormRuleIssue[] = [];
  if (!hasValue(values.property_id) && !hasValue(values.customer_id)) {
    out.push({ key: "party", label: "Müşteri ya da portföy", tab: "portfoy", field: "wz-deal-property" });
  }
  if (!hasValue(values.deal_value)) out.push({ key: "value", label: "Tutar", tab: "fiyat", field: "wz-deal-value" });
  return out;
}
