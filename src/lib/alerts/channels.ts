import { createHmac } from "node:crypto";
import { sendEmail } from "@/lib/email/provider";
import { discardExternalResponse, externalErrorMetadata, fetchExternal } from "@/lib/external-fetch";
import { openPlatformSecret, sealPlatformSecret } from "@/lib/platform-secrets";
import {
  channelSecretKey,
  decodeChannelConfig,
  encodeChannelConfig,
  parseWebhookUrl,
  type AlertChannelConfig,
} from "./channel-config";

/**
 * Uyarı kanalı gönderimi (SUNUCUYA ÖZEL). Telegram Bot API, e-posta (Resend; `email/provider.ts`) ve genel webhook.
 * Sahte gönderim YOK: kanal kapalıysa/anahtar yoksa sonuç `ok:false` + nedeni döner ve olay günlüğüne düşer.
 * Bot belirteci/webhook sırrı yalnız istek satırına/başlığına çıkar; sonuç metninde ve günlükte yer almaz.
 */

export type ChannelSendResult = { ok: boolean; detail: string };

const SEND_TIMEOUT_MS = 8_000;

export function sealChannelConfig(id: string, config: AlertChannelConfig): string | null {
  return sealPlatformSecret(channelSecretKey(id), encodeChannelConfig(config));
}

export function openChannelConfig(id: string, kind: string, sealed: string | null): AlertChannelConfig | null {
  return decodeChannelConfig(kind, openPlatformSecret(channelSecretKey(id), sealed));
}

/** Webhook gövdesinin HMAC-SHA256 imzası (alıcı aynı sırla doğrular). */
export function webhookSignature(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export async function sendToChannel(
  config: AlertChannelConfig,
  message: { subject: string; text: string; payload: Record<string, unknown> },
): Promise<ChannelSendResult> {
  try {
    if (config.kind === "telegram") {
      const res = await fetchExternal(
        `https://api.telegram.org/bot${config.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: config.chatId, text: message.text.slice(0, 4000), disable_web_page_preview: true }),
          cache: "no-store",
        },
        { timeoutMs: SEND_TIMEOUT_MS },
      );
      await discardExternalResponse(res);
      if (res.ok) return { ok: true, detail: "Telegram iletildi" };
      return {
        ok: false,
        detail: res.status === 401 ? "Telegram belirteci reddedildi (401)" : res.status === 400 ? "Telegram sohbet kimliği geçersiz ya da bot sohbete ekli değil (400)" : `Telegram HTTP ${res.status}`,
      };
    }
    if (config.kind === "email") {
      const r = await sendEmail({ to: config.to, subject: message.subject, text: message.text });
      if (r.ok) return { ok: true, detail: "E-posta iletildi" };
      return { ok: false, detail: r.code === "disabled" ? `kanal kapalı: ${r.error}` : `E-posta: ${r.error}` };
    }
    // Webhook: adres kayıtta doğrulandı; gönderimden önce yine denetlenir (eski kayıt / kural değişikliği).
    const url = parseWebhookUrl(config.url);
    if (!url.ok) return { ok: false, detail: `Webhook adresi reddedildi: ${url.error}` };
    const body = JSON.stringify(message.payload);
    const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": "emlaksoft-alerts/1.0" };
    if (config.secret) headers["X-EmlakSoft-Signature"] = webhookSignature(config.secret, body);
    const res = await fetchExternal(url.url, { method: "POST", headers, body, cache: "no-store" }, { timeoutMs: SEND_TIMEOUT_MS });
    await discardExternalResponse(res);
    return res.ok ? { ok: true, detail: `Webhook HTTP ${res.status}` } : { ok: false, detail: `Webhook HTTP ${res.status}` };
  } catch (e) {
    const meta = externalErrorMetadata(e);
    return { ok: false, detail: meta.kind === "timeout" ? "Zaman aşımı" : "Bağlantı hatası" };
  }
}
