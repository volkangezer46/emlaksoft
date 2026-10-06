import { fetchExternal, externalErrorMetadata } from "@/lib/external-fetch";

/**
 * E-posta sağlayıcı soyutlaması — tek adaptör: Resend (https://api.resend.com/emails).
 * `RESEND_API_KEY` + `EMAIL_FROM` (ör. "EmlakSoft <bildirim@alanadi.com>", alan adı Resend'de doğrulanmış olmalı) yoksa
 * kanal KAPALI: `sendEmail` hiçbir istek atmadan `{ ok:false, code:"disabled" }` döner; admin ekranı "kanal kapalı" der.
 * Gönderimler yalnız sunucuda; düz metin gövde (HTML yok). Yanıt gövdesi okunmaz (yalnız durum).
 */

export type EmailChannelStatus = { enabled: boolean; from: string | null; reason: string | null };

export function emailChannelStatus(): EmailChannelStatus {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim() || null;
  if (!key) return { enabled: false, from, reason: "RESEND_API_KEY tanımlı değil" };
  if (!from || !/<?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/.test(from)) return { enabled: false, from, reason: "EMAIL_FROM tanımlı değil veya geçersiz" };
  return { enabled: true, from, reason: null };
}

export type EmailSendResult = { ok: true; id: string | null } | { ok: false; code: "disabled" | "invalid" | "provider_error"; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function sendEmail(input: { to: string; subject: string; text: string }): Promise<EmailSendResult> {
  const status = emailChannelStatus();
  if (!status.enabled) return { ok: false, code: "disabled", error: status.reason ?? "E-posta kanalı kapalı" };
  const to = input.to.trim();
  if (!EMAIL_RE.test(to) || to.length > 254) return { ok: false, code: "invalid", error: "Geçersiz alıcı" };
  const subject = input.subject.replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  if (!subject || !input.text.trim()) return { ok: false, code: "invalid", error: "Konu/gövde boş" };
  try {
    const res = await fetchExternal(
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: status.from, to: [to], subject, text: input.text.slice(0, 20_000) }),
      },
      { timeoutMs: 8_000 },
    );
    let id: string | null = null;
    if (res.ok) {
      const json = (await res.json().catch(() => null)) as { id?: string } | null;
      id = typeof json?.id === "string" ? json.id : null;
      return { ok: true, id };
    }
    await res.body?.cancel().catch(() => undefined);
    return { ok: false, code: "provider_error", error: `HTTP ${res.status}` };
  } catch (e) {
    console.error("sendEmail", externalErrorMetadata(e));
    return { ok: false, code: "provider_error", error: "Bağlantı hatası" };
  }
}
