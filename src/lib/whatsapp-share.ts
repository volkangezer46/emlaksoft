/**
 * "WhatsApp'ta paylaş" (SAF): değerleme raporu ve portföy sunumu için token'lı bağlantı + wa.me. Mesajı kullanıcı kendi
 * WhatsApp'ından gönderir; sistem otomatik GÖNDERMEZ. Telefon yalnız saklanan biçimden okunur ve `formatPhoneDisplay` ile
 * gösterilir.
 *
 * İYS KAPISI: ileti türü ikiye ayrılır.
 *  - işlem amaçlı (transactional): kişinin kendi talebiyle ilgili rapor/bilgi (değerleme raporu). İYS gerekmez.
 *  - ticari (commercial): tanıtım/portföy önerisi (sunum). Alıcı BELLİ ise İYS'te WhatsApp için "granted" izin şarttır;
 *    alıcı belli değilse (kişiyi WhatsApp'ta siz seçersiniz) kapı uygulanamaz, uyarı notu gösterilir.
 */
import { buildWhatsAppLink, buildWhatsAppShareLink } from "@/lib/whatsapp-link";

export type ShareKind = "valuation" | "presentation";
export type SharePurpose = "transactional" | "commercial";

export const SHARE_PURPOSE: Record<ShareKind, SharePurpose> = {
  valuation: "transactional",
  presentation: "commercial",
};

export type ConsentStatus = "granted" | "denied" | "unknown" | "pending" | null;

export type ShareGate = { allowed: true; note: string | null } | { allowed: false; reason: string };

export const COMMERCIAL_UNKNOWN_RECIPIENT_NOTE =
  "Ticari ileti: alıcıyı WhatsApp'ta siz seçeceksiniz; kişinin İYS (ticari ileti) izni olduğundan emin olun.";

/** İYS kapısı (saf karar). */
export function whatsappShareGate(i: { purpose: SharePurpose; recipientKnown: boolean; consent: ConsentStatus }): ShareGate {
  if (i.purpose === "transactional") return { allowed: true, note: null };
  if (!i.recipientKnown) return { allowed: true, note: COMMERCIAL_UNKNOWN_RECIPIENT_NOTE };
  if (i.consent === "granted") return { allowed: true, note: null };
  return {
    allowed: false,
    reason:
      i.consent === "denied"
        ? "Bu kişi WhatsApp ile ticari iletiyi reddetmiş (İYS). Paylaşım yapılamaz."
        : "Bu kişi için WhatsApp ticari ileti izni (İYS) kayıtlı değil. Uyum sayfasından izni kaydedin ya da bağlantıyı başka yoldan iletin.",
  };
}

/** Paylaşım mesajı (kısa, tek bağlantı; kişisel veri ve tutar içermez). */
export function buildShareMessage(i: { kind: ShareKind; officeName: string | null; recipientName: string | null; title: string | null; url: string }): string {
  const greet = i.recipientName ? `Merhaba ${i.recipientName.split(/\s+/)[0]},` : "Merhaba,";
  const office = i.officeName ? ` (${i.officeName})` : "";
  if (i.kind === "valuation") {
    return `${greet} ${i.title ? `"${i.title}" ` : ""}değerleme raporunuz hazır${office}: ${i.url}`;
  }
  return `${greet} sizin için hazırladığımız portföy sunumu${i.title ? ` "${i.title}"` : ""}${office}: ${i.url}`;
}

/** wa.me bağlantısı: alıcının kayıtlı cep numarası varsa doğrudan ona, yoksa alıcı seçtiren paylaşım. */
export function buildShareHref(phone: string | null | undefined, message: string): { href: string | null; direct: boolean } {
  const direct = buildWhatsAppLink(phone, message);
  if (direct) return { href: direct, direct: true };
  return { href: buildWhatsAppShareLink(message), direct: false };
}
