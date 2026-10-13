import { fetchExternal, externalErrorMetadata } from "@/lib/external-fetch";
import { getPlatformSettingsMany } from "@/lib/platform-settings";
import { revealSecret } from "@/lib/settings/secrets";
import { EMAIL_FROM_RE } from "@/lib/settings/registry/platform";

/**
 * E-posta sağlayıcı soyutlaması — tek adaptör: Resend (https://api.resend.com/emails).
 * Anahtar ve gönderen çözüm SIRASI (her biri için ayrı): ortam değişkeni (RESEND_API_KEY / EMAIL_FROM / EMAIL_REPLY_TO,
 * öncelikli) > panelden girilen ayar (`email.resend_api_key` şifreli, `email.from`, `email.reply_to`) > yok.
 * Anahtar ya da geçerli gönderen çözülemezse kanal KAPALI: `sendEmail` hiçbir istek atmadan `{ ok:false, code:"disabled" }`
 * döner; admin ekranı "kanal kapalı" ve nedenini der (sessiz hata yok). Şifreli anahtar çözülemezse de kanal kapalıdır.
 * Gönderimler yalnız sunucuda; düz metin gövde + isteğe bağlı HTML (ortak marka yerleşimi, `templates.ts` üretir; değerler
 * kaçışlanmış). Anahtar değeri bu modülden yalnız istek başlığına çıkar. Günlük/bastırma sarmalayıcısı: `send.ts`
 * (`sendLoggedEmail`); uygulama kodu doğrudan bu işlevi DEĞİL, onu çağırır.
 */

/** Panel ayarlarının depo anahtarları (ayar defteri `registry/platform.ts` ile aynı; storageKey = key). */
export const EMAIL_SETTING_KEYS = {
  apiKey: "email.resend_api_key",
  from: "email.from",
  replyTo: "email.reply_to",
} as const;

export type EmailValueSource = "env" | "panel" | "none";

export type EmailChannelStatus = {
  enabled: boolean;
  from: string | null;
  replyTo: string | null;
  reason: string | null;
  keySource: EmailValueSource;
  fromSource: EmailValueSource;
};

type ResolvedEmailChannel = EmailChannelStatus & { apiKey: string | null };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Gönderen adresinin alan adı (Resend alan adı eşleşmesi için); geçersizse null. */
export function emailFromDomain(from: string | null | undefined): string | null {
  const m = /@([^\s@<>]+\.[^\s@<>]+)>?$/.exec((from ?? "").trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * SAF çözüm: env > panel > kapalı. `storedKey` = panelden çözülmüş düz anahtar (çözülemediyse null),
 * `storedKeyUndecryptable` = panelde şifreli kayıt var ama açılamadı.
 */
export function resolveEmailChannel(
  env: { RESEND_API_KEY?: string; EMAIL_FROM?: string; EMAIL_REPLY_TO?: string },
  stored: { apiKey: string | null; apiKeyUndecryptable?: boolean; from: string | null; replyTo: string | null },
): ResolvedEmailChannel {
  const envKey = env.RESEND_API_KEY?.trim() || null;
  const panelKey = stored.apiKey?.trim() || null;
  const apiKey = envKey ?? panelKey;
  const keySource: EmailValueSource = envKey ? "env" : panelKey ? "panel" : "none";

  const envFrom = env.EMAIL_FROM?.trim() || null;
  const panelFrom = stored.from?.trim() || null;
  const from = envFrom ?? panelFrom;
  const fromSource: EmailValueSource = envFrom ? "env" : panelFrom ? "panel" : "none";

  const replyRaw = env.EMAIL_REPLY_TO?.trim() || stored.replyTo?.trim() || null;
  const replyTo = replyRaw && EMAIL_RE.test(replyRaw) ? replyRaw : null;

  const base = { from, replyTo, keySource, fromSource, apiKey };
  if (!apiKey) {
    const reason = stored.apiKeyUndecryptable
      ? "Panelde kayıtlı Resend anahtarı çözülemiyor (PLATFORM_SECRETS_KEY değişmiş olabilir); anahtarı yeniden girin"
      : "Resend API anahtarı tanımlı değil (ne sunucu ortamında ne panelde)";
    return { ...base, enabled: false, reason };
  }
  if (!from || !EMAIL_FROM_RE.test(from)) {
    return { ...base, enabled: false, reason: "Gönderen adresi (EMAIL_FROM) tanımlı değil veya geçersiz" };
  }
  return { ...base, enabled: true, reason: null };
}

async function readStored(): Promise<{ apiKey: string | null; apiKeyUndecryptable: boolean; from: string | null; replyTo: string | null }> {
  try {
    const raw = await getPlatformSettingsMany([EMAIL_SETTING_KEYS.apiKey, EMAIL_SETTING_KEYS.from, EMAIL_SETTING_KEYS.replyTo]);
    const sealed = raw[EMAIL_SETTING_KEYS.apiKey] ?? null;
    const apiKey = revealSecret(EMAIL_SETTING_KEYS.apiKey, sealed);
    return {
      apiKey,
      apiKeyUndecryptable: Boolean(sealed) && !apiKey,
      from: raw[EMAIL_SETTING_KEYS.from] ?? null,
      replyTo: raw[EMAIL_SETTING_KEYS.replyTo] ?? null,
    };
  } catch {
    return { apiKey: null, apiKeyUndecryptable: false, from: null, replyTo: null };
  }
}

/** SUNUCU İÇİ: anahtar dahil çözülmüş yapılandırma (bağlantı testi ve gönderim için). İstemciye verilmez. */
export async function resolveEmailChannelConfig(): Promise<ResolvedEmailChannel> {
  const env = { RESEND_API_KEY: process.env.RESEND_API_KEY, EMAIL_FROM: process.env.EMAIL_FROM, EMAIL_REPLY_TO: process.env.EMAIL_REPLY_TO };
  return resolveEmailChannel(env, await readStored());
}

/** Ekran için durum (anahtar değeri YOK). */
export async function emailChannelStatus(): Promise<EmailChannelStatus> {
  const { apiKey: _omit, ...status } = await resolveEmailChannelConfig();
  void _omit;
  return status;
}

export type EmailSendResult = { ok: true; id: string | null } | { ok: false; code: "disabled" | "invalid" | "provider_error"; error: string };

export async function sendEmail(input: { to: string; subject: string; text: string; html?: string }): Promise<EmailSendResult> {
  const cfg = await resolveEmailChannelConfig();
  if (!cfg.enabled || !cfg.apiKey) return { ok: false, code: "disabled", error: cfg.reason ?? "E-posta kanalı kapalı" };
  const to = input.to.trim();
  if (!EMAIL_RE.test(to) || to.length > 254) return { ok: false, code: "invalid", error: "Geçersiz alıcı" };
  const subject = input.subject.replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  if (!subject || !input.text.trim()) return { ok: false, code: "invalid", error: "Konu/gövde boş" };
  try {
    const res = await fetchExternal(
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: cfg.from,
          to: [to],
          subject,
          text: input.text.slice(0, 20_000),
          ...(input.html ? { html: input.html.slice(0, 100_000) } : {}),
          ...(cfg.replyTo ? { reply_to: cfg.replyTo } : {}),
        }),
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
