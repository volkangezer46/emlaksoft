/**
 * Public formdan gelen talep mesajının nereye yazılacağı — SAF karar katmanı.
 *
 * NEDEN AYRI MODÜL (denetim P0): `lead-intake.ts` mesajı (`input.message`)
 * YALNIZCA yeni müşteri insert'inde `customers.notes` alanına yazıyordu.
 * Telefonu eşleşen MEVCUT müşteri geldiğinde (`duplicate = true`) mesaj
 * hiçbir yere gitmiyor, sessizce kayboluyordu. En ağır sonucu vitrindeki
 * değerleme hunisinde: `public-valuation.ts` tüm değerleme detayını
 * (ilçe, m², oda, ön tahmin aralığı) `message` içine koyuyor — mevcut bir
 * müşteri formu ikinci kez doldurunca talep GÖRÜNMEZ oluyordu.
 *
 * NEDEN `communications` (müşteri notuna eklemek yerine):
 *   1. `customers.notes` tek bir metin alanı; ekleme yapmak için önce okuyup
 *      birleştirmek gerekir — iki eşzamanlı form gönderiminde biri diğerini
 *      ezer (read-modify-write yarışı). `communications` insert'i atomiktir.
 *   2. `communications` zaten müşteri detayındaki iletişim zaman çizgisinin
 *      ve `/app/gelen-kutusu` sayfasının kaynağı; `direction = 'inbound'`
 *      kayıtlar orada "gelen" olarak sayılıyor. Talep, danışmanın zaten
 *      baktığı yerde görünür oluyor.
 *   3. Her talep ayrı satır: zaman damgası, kanal ve kaynak yapısal kalır.
 *
 * Enum değerleri migration 20260723000032 ile DOĞRULANDI:
 *   comm_channel   = ('call','whatsapp','sms','email','note','meeting')
 *   comm_direction = ('inbound','outbound','internal')
 * Web formu için kanal karşılığı yok → `note` (serbest kayıt) kullanılır,
 * yön `inbound`. Gerçek kanal `subject` içinde metin olarak korunur.
 */

/** `communications` tablosuna yazılacak satır (tenant_id hariç saf gövde). */
export type LeadCommunicationDraft = {
  customer_id: string;
  channel: "note" | "whatsapp" | "sms" | "email" | "call";
  direction: "inbound";
  subject: string;
  body: string;
  outcome: string;
};

/** Lead kanalını `comm_channel` enum değerine eşler; bilinmeyen → 'note'. */
export function leadChannelToCommChannel(channel: string | null | undefined): LeadCommunicationDraft["channel"] {
  const c = (channel ?? "").trim().toLowerCase();
  if (c === "whatsapp") return "whatsapp";
  if (c === "sms") return "sms";
  if (c === "email" || c === "e-posta") return "email";
  if (c === "call" || c === "telefon" || c === "phone") return "call";
  // web_form, vitrin, portal, bilinmeyen ... → serbest kayıt
  return "note";
}

/**
 * Talep mesajını `communications` satırına çevirir.
 *
 * SÖZLEŞME: mesaj boş DEĞİLSE burası ASLA null dönmez — mükerrer lead'in
 * mesajı hiçbir koşulda sessizce düşmez. Boş mesajda yazacak bir şey
 * olmadığından null döner (talep zaten `audit_logs` + bildirimle iz bırakır).
 */
export function buildLeadCommunication(input: {
  customerId: string;
  message?: string | null;
  channel?: string | null;
  source?: string | null;
  duplicate: boolean;
}): LeadCommunicationDraft | null {
  const body = (input.message ?? "").trim();
  if (!body) return null;
  if (!input.customerId) return null;

  const source = (input.source ?? "").trim();
  const subject = input.duplicate
    ? `Mevcut müşteriden yeni talep${source ? ` · ${source}` : ""}`
    : `Yeni talep${source ? ` · ${source}` : ""}`;

  return {
    customer_id: input.customerId,
    channel: leadChannelToCommChannel(input.channel),
    direction: "inbound",
    subject: subject.slice(0, 200),
    body,
    outcome: input.duplicate ? "mukerrer_talep" : "yeni_talep",
  };
}
