/**
 * Gelen mesaj ilk temas akışının SAF kararları (COM-02; testli). Sunucu katmanı: inbound-intake.ts.
 */

export type InboundChannel = "whatsapp" | "sms";

/** Bilinmeyen numaradan açılan kaydın kaynağı (Kaynak raporu ve otomasyon "kaynak" koşulu bu değeri görür). */
export function inboundSourceFor(channel: InboundChannel): string {
  return channel === "whatsapp" ? "whatsapp_inbound" : "sms_inbound";
}

/** Kayıt adı: danışman aradığında gerçek adı yazar; o zamana kadar kanal + numara görünür. */
export function inboundLeadName(channel: InboundChannel, phoneDisplay: string): string {
  return `${channel === "whatsapp" ? "WhatsApp" : "SMS"} · ${phoneDisplay}`.slice(0, 120);
}

export const ACK_COOLDOWN_MS = 24 * 3_600_000;

/**
 * Karşılama gönderilsin mi? Kapalıysa ya da son karşılama 24 saatten yeniyse hayır. Metin mesai içi/dışı ayarından;
 * boş metin gönderilmez.
 */
export function ackDecision(input: {
  enabled: boolean;
  lastAckAt: string | null;
  nowMs: number;
  inHours: boolean;
  textHours: string;
  textAfter: string;
}): { send: true; text: string } | { send: false; reason: "disabled" | "cooldown" | "empty" } {
  if (!input.enabled) return { send: false, reason: "disabled" };
  if (input.lastAckAt) {
    const last = Date.parse(input.lastAckAt);
    if (!Number.isFinite(last) || input.nowMs - last < ACK_COOLDOWN_MS) return { send: false, reason: "cooldown" };
  }
  const text = (input.inHours ? input.textHours : input.textAfter).trim().slice(0, 1000);
  if (!text) return { send: false, reason: "empty" };
  return { send: true, text };
}
