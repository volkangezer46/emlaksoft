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

/** Başvuru formunun üç metni. Varsayılan = bu dosyadaki sabitler; yönetim panelinden (/admin/ayarlar/yasal) değiştirilebilir. */
export type LeadFormCopy = { consent: string; notice: string; marketing: string };

export const DEFAULT_LEAD_FORM_COPY: LeadFormCopy = {
  consent: LEAD_FORM_CONSENT_TEXT,
  notice: LEAD_FORM_NOTICE_TEXT,
  marketing: LEAD_FORM_MARKETING_TEXT,
};

/** Kısa, deterministik metin izi (FNV-1a 32 bit, onaltılık). Saf; istemcide de çalışır (crypto gerekmez). */
function textFingerprint(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Sürüm + pazarlama tercihi -> saklanacak consent_version (en çok 80 karakter; DB CHECK ile uyumlu).
 * Metin yönetimden değiştirildiyse sürüm metnin izini taşır (`…-c<iz>`): rıza kanıtı hangi metnin onaylandığını gösterir;
 * metin varsayılana dönünce sürüm de eski değerine döner.
 */
export function buildLeadConsentVersion(marketingOptIn: boolean, copy: LeadFormCopy = DEFAULT_LEAD_FORM_COPY): string {
  const custom =
    copy.consent !== DEFAULT_LEAD_FORM_COPY.consent || copy.notice !== DEFAULT_LEAD_FORM_COPY.notice || copy.marketing !== DEFAULT_LEAD_FORM_COPY.marketing;
  const base = custom ? `${LEAD_CONSENT_TEXT_VERSION}-c${textFingerprint(`${copy.consent}\u0000${copy.notice}\u0000${copy.marketing}`)}` : LEAD_CONSENT_TEXT_VERSION;
  return marketingOptIn ? `${base}${LEAD_CONSENT_MARKETING_SUFFIX}` : base;
}
