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

/** E-posta eki (DG4 zamanlanmış rapor). İçerik ham bayt; Resend'e base64 gider. */
export type EmailAttachment = { filename: string; content: Uint8Array };

/** Tek iletideki eklerin toplam bayt tavanı (Resend 40 MB kabul eder; bellek ve teslim için bilinçli düşük). */
export const EMAIL_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: readonly EmailAttachment[];
}): Promise<EmailSendResult> {
  const cfg = await resolveEmailChannelConfig();
  if (!cfg.enabled || !cfg.apiKey) return { ok: false, code: "disabled", error: cfg.reason ?? "E-posta kanalı kapalı" };
  const to = input.to.trim();
  if (!EMAIL_RE.test(to) || to.length > 254) return { ok: false, code: "invalid", error: "Geçersiz alıcı" };
  const subject = input.subject.replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  if (!subject || !input.text.trim()) return { ok: false, code: "invalid", error: "Konu/gövde boş" };
  const attachments = input.attachments ?? [];
  if (attachments.reduce((sum, a) => sum + a.content.byteLength, 0) > EMAIL_ATTACHMENT_MAX_BYTES) {
    return { ok: false, code: "invalid", error: "Ek dosya çok büyük" };
  }
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
          ...(attachments.length
            ? { attachments: attachments.map((a) => ({ filename: a.filename.replace(/[\r\n"]/g, "").slice(0, 120), content: Buffer.from(a.content).toString("base64") })) }
            : {}),
        }),
      },
      { timeoutMs: attachments.length ? 20_000 : 8_000 },
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

export type ResolvedEmailConfig = ResolvedEmailChannel;

export type EmailBatchItem = { to: string; subject: string; text: string };

/**
 * Toplu gönderim sonucu (öğe sırasıyla). `retryable`: sağlayıcı hız sınırı (429) ya da 5xx (istek işlenmedi);
 * çağıran satırı daha sonra yeniden denemelidir ('failed' yazmamalıdır).
 */
export type EmailBatchResult =
  | { ok: true; id: string | null }
  | { ok: false; code: "disabled" | "invalid" | "provider_error"; error: string; retryable: boolean };

/** Resend toplu uç noktasının tek istekteki en çok ileti sayısı. */
export const EMAIL_BATCH_MAX = 100;

/**
 * Resend TOPLU gönderim (`/emails/batch`, istek başına en çok 100 ileti). Yapılandırma çağıran tarafından BİR KEZ
 * çözülür (`resolveEmailChannelConfig`) ve verilir: öğe başına ayar okuması yok. Geçersiz öğeler istek atılmadan
 * 'invalid' döner; geçerli olanlar tek istekte gider. Hız sınırı çağıranın işidir (istek sayısı = ceil(n/100)).
 */
export async function sendEmailBatch(cfg: ResolvedEmailConfig, items: readonly EmailBatchItem[]): Promise<EmailBatchResult[]> {
  const out: EmailBatchResult[] = new Array(items.length);
  if (!cfg.enabled || !cfg.apiKey) {
    for (let i = 0; i < items.length; i++) out[i] = { ok: false, code: "disabled", error: cfg.reason ?? "E-posta kanalı kapalı", retryable: false };
    return out;
  }
  const valid: { index: number; payload: Record<string, unknown> }[] = [];
  items.forEach((input, index) => {
    const to = input.to.trim();
    const subject = input.subject.replace(/[\r\n]+/g, " ").trim().slice(0, 200);
    if (!EMAIL_RE.test(to) || to.length > 254) out[index] = { ok: false, code: "invalid", error: "Geçersiz alıcı", retryable: false };
    else if (!subject || !input.text.trim()) out[index] = { ok: false, code: "invalid", error: "Konu/gövde boş", retryable: false };
    else
      valid.push({
        index,
        payload: { from: cfg.from, to: [to], subject, text: input.text.slice(0, 20_000), ...(cfg.replyTo ? { reply_to: cfg.replyTo } : {}) },
      });
  });
  for (let i = 0; i < valid.length; i += EMAIL_BATCH_MAX) {
    const chunk = valid.slice(i, i + EMAIL_BATCH_MAX);
    const fail = (error: string, retryable: boolean) => {
      for (const v of chunk) out[v.index] = { ok: false, code: "provider_error", error, retryable };
    };
    try {
      const res = await fetchExternal(
        "https://api.resend.com/emails/batch",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(chunk.map((v) => v.payload)),
        },
        { timeoutMs: 15_000 },
      );
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        fail(`HTTP ${res.status}`, res.status === 429 || res.status >= 500);
        continue;
      }
      const json = (await res.json().catch(() => null)) as { data?: { id?: string }[] } | null;
      chunk.forEach((v, k) => {
        const id = json?.data?.[k]?.id;
        out[v.index] = { ok: true, id: typeof id === "string" ? id : null };
      });
    } catch (e) {
      // Zaman aşımında ileti sağlayıcıda gitmiş olabilir: kendiliğinden yeniden deneme çift gönderim yaratır.
      // 'failed' kalır; arşivdeki "yeniden dene" bilinçli karardır.
      console.error("sendEmailBatch", externalErrorMetadata(e));
      fail("Bağlantı hatası", false);
    }
  }
  return out;
}
