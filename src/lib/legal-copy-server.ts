import "server-only";
import { DEFAULT_LEAD_FORM_COPY, type LeadFormCopy } from "@/lib/legal-copy";
import { getSettings } from "@/lib/settings/read";

const KEYS = { consent: "legal.lead_consent_text", notice: "legal.lead_notice_text", marketing: "legal.lead_marketing_text" } as const;

/**
 * Başvuru formu metinleri (ayar defterinden; yoksa/okunamazsa legal-copy.ts varsayılanı). Form ve rıza kanıtı
 * sürümü (`buildLeadConsentVersion(…, copy)`) AYNI değeri kullanır: gösterilen metin ile kanıttaki sürüm tutarlı.
 */
export async function getLeadFormCopy(): Promise<LeadFormCopy> {
  try {
    const s = await getSettings(Object.values(KEYS));
    const pick = (k: keyof typeof KEYS) => {
      const v = s[KEYS[k]];
      return typeof v === "string" && v.trim().length >= 10 ? v.trim() : DEFAULT_LEAD_FORM_COPY[k];
    };
    return { consent: pick("consent"), notice: pick("notice"), marketing: pick("marketing") };
  } catch {
    return DEFAULT_LEAD_FORM_COPY;
  }
}
