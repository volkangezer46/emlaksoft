/**
 * Hukuki metin sabitleri (TEK kaynak). İstemciden de import edilebilir (sunucu modülü içermez).
 *
 * Not: Metin sorumluluğu ofis/şirket sahibindedir. Bu dosyada yalnız YAPI
 * (aydınlatma bilgisi / zorunlu onay / ayrı opsiyonel pazarlama kutusu) ve nötr amaç ifadesi düzeltildi;
 * eski "tanıtım amacıyla" ifadesi formun gerçek amacıyla (talebe dönüş) örtüşmediği için "talebime dönüş
 * yapılması" olarak değiştirildi.
 */

/** Form onay kutusu (zorunlu): amaç = başvurunun yanıtlanması. */
export const LEAD_FORM_CONSENT_TEXT = "Kişisel verilerimin talebime dönüş yapılması amacıyla işlenmesini kabul ediyorum.";

/** Bilgi satırı (onay kutusu DEĞİL): aydınlatma metnine yönlendirir. */
export const LEAD_FORM_NOTICE_TEXT = "Başvurunuzdaki bilgilerin nasıl işlendiği aydınlatma metninde açıklanır.";

/** Opsiyonel, AYRI pazarlama izni kutusu (varsayılan işaretsiz; talep bu kutuya bağlı değildir). */
export const LEAD_FORM_MARKETING_TEXT = "Ofisten kampanya ve tanıtım iletileri almak istiyorum (isteğe bağlı).";

/** Gönderilen metin sürümü: rıza kanıtında (public_lead_consent_events.consent_version) saklanır. Metin değişince artırın. */
export const LEAD_CONSENT_TEXT_VERSION = "lead-intake-v2-2026-10";
/** Pazarlama kutusu işaretliyse sürüme eklenen ek (kanıtta ayrı izin olarak görünür). */
export const LEAD_CONSENT_MARKETING_SUFFIX = "+mkt";

/** Sürüm + pazarlama tercihi -> saklanacak consent_version (en çok 80 karakter; DB CHECK ile uyumlu). */
export function buildLeadConsentVersion(marketingOptIn: boolean): string {
  return marketingOptIn ? `${LEAD_CONSENT_TEXT_VERSION}${LEAD_CONSENT_MARKETING_SUFFIX}` : LEAD_CONSENT_TEXT_VERSION;
}
