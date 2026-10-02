/**
 * Netgsm SMS API entegrasyonu
 * Docs: https://www.netgsm.com.tr/dokuman/
 *
 * Ortam değişkenleri (platform_settings veya env):
 *   NETGSM_USERCODE  — müşteri kodu
 *   NETGSM_PASSWORD  — şifre
 *   NETGSM_MSGHEADER — onaylı başlık (gönderici adı)
 */

import { getPlatformSetting } from "@/lib/platform-settings";
import {
  discardExternalResponse,
  fetchExternal,
  readExternalJson,
  readExternalText,
} from "@/lib/external-fetch";
import {
  normalizeProviderBaseUrl,
  providerAllowedHosts,
} from "@/lib/integrations/provider-url";
import { isAmbiguousWhatsAppHttpStatus } from "@/lib/messaging/whatsapp-contract";

const PROVIDER_TIMEOUT_MS = 10_000;
const WHATSAPP_MAX_RESPONSE_BYTES = 256 * 1024;
const NETGSM_MAX_RESPONSE_BYTES = 64 * 1024;
const WHATSAPP_GRAPH_ORIGIN = "https://graph.facebook.com";

export type NetgsmConfig = {
  usercode: string;
  password: string;
  msgheader: string;
};

export type SmsSendResult = {
  ok: boolean;
  jobid?: string;   // Netgsm'in döndürdüğü iş ID'si
  error?: string;
  code?: string;    // Netgsm hata kodu
};

export type SmsBulkResult = {
  ok: boolean;
  jobid?: string;
  error?: string;
  failedIndexes?: number[]; // hangi alıcılar başarısız
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Önce DB'den (platform_settings), yoksa env'den okur. */
export async function getNetgsmConfig(): Promise<NetgsmConfig | null> {
  const [usercode, password, msgheader] = await Promise.all([
    getPlatformSetting("netgsm_usercode"),
    getPlatformSetting("netgsm_password"),
    getPlatformSetting("netgsm_msgheader"),
  ]);

  const uc = usercode ?? process.env.NETGSM_USERCODE ?? "";
  const pw = password ?? process.env.NETGSM_PASSWORD ?? "";
  const mh = msgheader ?? process.env.NETGSM_MSGHEADER ?? "";

  if (!uc || !pw || !mh) return null;
  return { usercode: uc, password: pw, msgheader: mh };
}

export async function isNetgsmConfigured(): Promise<boolean> {
  const cfg = await getNetgsmConfig();
  return cfg !== null;
}

// ---------------------------------------------------------------------------
// Tek SMS gönder
// ---------------------------------------------------------------------------

/**
 * Tek alıcıya SMS gönderir.
 * @param to   Telefon no (başında 0 veya +90 olabilir, normalize edilir)
 * @param text Mesaj metni (max 160 karakter, Türkçe karakter varsa 70)
 */
export async function sendSms(to: string, text: string): Promise<SmsSendResult> {
  const cfg = await getNetgsmConfig();
  if (!cfg) return { ok: false, error: "Netgsm yapılandırılmamış." };

  return sendSmsWithConfig(cfg, to, text);
}

/** Server-only tenant callers can provide an already isolated Netgsm config. */
export async function sendSmsWithConfig(
  cfg: NetgsmConfig,
  to: string,
  text: string,
): Promise<SmsSendResult> {
  const phone = normalizePhone(to);
  if (!phone) return { ok: false, error: "Geçersiz telefon numarası." };

  const xml = buildSingleXml(cfg, [phone], text);
  return postXml(xml);
}

// ---------------------------------------------------------------------------
// Toplu SMS gönder (kampanya)
// ---------------------------------------------------------------------------

/**
 * Birden fazla alıcıya aynı mesajı gönderir.
 * Netgsm'in toplu XML API'sini kullanır.
 */
export async function sendBulkSms(
  recipients: { phone: string; name?: string }[],
  text: string,
): Promise<SmsBulkResult> {
  const cfg = await getNetgsmConfig();
  if (!cfg) return { ok: false, error: "Netgsm yapılandırılmamış." };

  const phones = recipients
    .map((r) => normalizePhone(r.phone))
    .filter((p): p is string => !!p);

  if (!phones.length) return { ok: false, error: "Geçerli telefon numarası bulunamadı." };

  const xml = buildSingleXml(cfg, phones, text);
  const result = await postXml(xml);
  return result;
}

// ---------------------------------------------------------------------------
// WhatsApp (Meta Business API / üçüncü taraf ağ geçidi)
// ---------------------------------------------------------------------------

export type WhatsAppSendResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
  code?: string;
};

export type WhatsAppTemplateMessage = {
  name: string;
  language: string;
  /** A campaign template may expose at most one text parameter in its body. */
  bodyParameter?: string;
};

export type WhatsAppConfig = {
  apiUrl: string;
  apiToken: string;
};

function configuredWhatsAppOrigins(): Set<string> {
  const origins = new Set([WHATSAPP_GRAPH_ORIGIN]);
  for (const raw of (process.env.WHATSAPP_ALLOWED_API_ORIGINS ?? "").split(",")) {
    const candidate = raw.trim();
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      const normalized = normalizeProviderBaseUrl(
        candidate,
        providerAllowedHosts([parsed.hostname]),
      );
      if (normalized === parsed.origin) origins.add(parsed.origin.toLowerCase());
    } catch {
      // Invalid deployment allow-list entries fail closed.
    }
  }
  return origins;
}

export function normalizeAllowedWhatsAppApiUrl(rawUrl: string): string | null {
  try {
    const origins = configuredWhatsAppOrigins();
    const normalized = normalizeProviderBaseUrl(
      rawUrl,
      providerAllowedHosts([...origins].map((origin) => new URL(origin).hostname)),
    );
    if (!normalized) return null;
    return origins.has(new URL(normalized).origin) ? normalized : null;
  } catch {
    return null;
  }
}

export function isAllowedWhatsAppApiUrl(rawUrl: string): boolean {
  return normalizeAllowedWhatsAppApiUrl(rawUrl) != null;
}

export async function getWhatsAppConfig(): Promise<WhatsAppConfig | null> {
  const [apiUrl, apiToken] = await Promise.all([
    getPlatformSetting("whatsapp_api_url"),
    getPlatformSetting("whatsapp_api_token"),
  ]);

  const url = apiUrl ?? process.env.WHATSAPP_API_URL ?? "";
  const token = apiToken ?? process.env.WHATSAPP_API_TOKEN ?? "";
  const normalizedUrl = normalizeAllowedWhatsAppApiUrl(url);
  return normalizedUrl && token
    ? { apiUrl: normalizedUrl, apiToken: token }
    : null;
}

/**
 * WhatsApp mesajı gönderir.
 * Şu an iskelet — gerçek entegrasyon için platform_settings'te
 * whatsapp_api_url + whatsapp_api_token tanımlanmalı.
 */
export async function sendWhatsApp(
  to: string,
  text: string,
): Promise<WhatsAppSendResult> {
  const config = await getWhatsAppConfig();
  if (!config) {
    return { ok: false, error: "WhatsApp API yapılandırılmamış." };
  }

  return sendWhatsAppWithConfig(config, to, text);
}

export async function sendWhatsAppWithConfig(
  config: WhatsAppConfig,
  to: string,
  text: string,
): Promise<WhatsAppSendResult> {
  const phone = normalizePhone(to);
  if (!phone) return { ok: false, error: "Geçersiz telefon numarası." };
  const apiUrl = normalizeAllowedWhatsAppApiUrl(config.apiUrl);
  if (!apiUrl) {
    return { ok: false, code: "provider_config_invalid", error: "WhatsApp API adresi geçersiz." };
  }

  let res: Response;
  try {
    res = await fetchExternal(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiToken}`,
      },
      body: JSON.stringify({
        to: `90${phone}`,  // Uluslararası format
        type: "text",
        text: { body: text },
      }),
      redirect: "error",
    }, { timeoutMs: PROVIDER_TIMEOUT_MS });

    if (!res.ok) {
      await discardExternalResponse(res);
      if (isAmbiguousWhatsAppHttpStatus(res.status)) {
        return {
          ok: false,
          code: "unknown_provider_outcome",
          error: "WhatsApp gönderim sonucu belirsiz; manuel mutabakat gerekli.",
        };
      }
      return { ok: false, code: `http_${res.status}`, error: `WhatsApp sağlayıcısı HTTP ${res.status} hatası döndürdü.` };
    }

    const data = await readExternalJson<{ messages?: Array<{ id?: unknown }> }>(
      res,
      WHATSAPP_MAX_RESPONSE_BYTES,
    );
    const messageId = data.messages?.[0]?.id;
    return typeof messageId === "string" && messageId.length <= 2_048
      ? { ok: true, messageId }
      : {
          ok: false,
          code: "unknown_provider_outcome",
          error: "WhatsApp kabul yanıtı teslimat kimliği içermedi; manuel mutabakat gerekli.",
        };
  } catch {
    return {
      ok: false,
      code: "unknown_provider_outcome",
      error: "WhatsApp gönderim sonucu belirsiz; otomatik tekrar güvenli değil.",
    };
  }
}

export function isValidWhatsAppTemplateMessage(
  template: WhatsAppTemplateMessage,
): boolean {
  return /^[a-z0-9_]{1,512}$/.test(template.name) &&
    /^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(template.language) &&
    (template.bodyParameter === undefined || template.bodyParameter.length <= 612);
}

/**
 * Sends a business-initiated WhatsApp message through Meta's approved-template
 * contract. Campaign code must use this path and must never downgrade to text.
 */
export async function sendWhatsAppTemplateWithConfig(
  config: WhatsAppConfig,
  to: string,
  template: WhatsAppTemplateMessage,
): Promise<WhatsAppSendResult> {
  const phone = normalizePhone(to);
  if (!phone) return { ok: false, code: "invalid_phone", error: "Geçersiz telefon numarası." };
  const apiUrl = normalizeAllowedWhatsAppApiUrl(config.apiUrl);
  if (!apiUrl) {
    return { ok: false, code: "provider_config_invalid", error: "WhatsApp API adresi geçersiz." };
  }
  if (!isValidWhatsAppTemplateMessage(template)) {
    return {
      ok: false,
      code: "whatsapp_template_invalid",
      error: "WhatsApp kampanya şablonu geçersiz.",
    };
  }

  const components = template.bodyParameter
    ? [{
        type: "body",
        parameters: [{ type: "text", text: template.bodyParameter }],
      }]
    : undefined;

  let res: Response;
  try {
    res = await fetchExternal(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiToken}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: `90${phone}`,
        type: "template",
        template: {
          name: template.name,
          language: { code: template.language },
          ...(components ? { components } : {}),
        },
      }),
      redirect: "error",
    }, { timeoutMs: PROVIDER_TIMEOUT_MS });
  } catch {
    return {
      ok: false,
      code: "unknown_provider_outcome",
      error: "WhatsApp gönderim sonucu belirsiz; otomatik tekrar güvenli değil.",
    };
  }

  if (!res.ok) {
    await discardExternalResponse(res);
    if (isAmbiguousWhatsAppHttpStatus(res.status)) {
      return {
        ok: false,
        code: "unknown_provider_outcome",
        error: "WhatsApp gönderim sonucu belirsiz; manuel mutabakat gerekli.",
      };
    }
    return {
      ok: false,
      code: `http_${res.status}`,
      error: `WhatsApp sağlayıcısı HTTP ${res.status} hatası döndürdü.`,
    };
  }

  const data = await readExternalJson<{
    messages?: Array<{ id?: string }>;
  }>(res, WHATSAPP_MAX_RESPONSE_BYTES).catch(() => null);
  const messageId = data?.messages?.[0]?.id;
  return messageId && messageId.length <= 2_048
    ? { ok: true, messageId }
    : {
        ok: false,
        code: "unknown_provider_outcome",
        error: "WhatsApp kabul yanıtı teslimat kimliği içermedi; manuel mutabakat gerekli.",
      };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** TR cep numarasını 10 haneli formata normalize eder (5xxxxxxxxx). */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("90") && digits.length === 12) return digits.slice(2);
  if (digits.startsWith("0")  && digits.length === 11)  return digits.slice(1);
  if (digits.startsWith("5")  && digits.length === 10)  return digits;
  return null;
}

/** XML özel karakterlerini kaçırır (usercode/password/msgheader güvenli gömme). */
function xmlEscape(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildSingleXml(cfg: NetgsmConfig, phones: string[], text: string): string {
  // Her numara kendi <no> düğümünde; DIŞ sarmalayıcı <no> YOK (Netgsm 1:n şeması).
  const nos = phones.map((p) => `<no>${p}</no>`).join("\n    ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<mainbody>
  <header>
    <usercode>${xmlEscape(cfg.usercode)}</usercode>
    <password>${xmlEscape(cfg.password)}</password>
    <msgheader>${xmlEscape(cfg.msgheader)}</msgheader>
    <type>1:n</type>
  </header>
  <body>
    <msg><![CDATA[${text.replace(/]]>/g, "]] >")}]]></msg>
    ${nos}
  </body>
</mainbody>`;
}

async function postXml(xml: string): Promise<SmsSendResult> {
  try {
    const res = await fetchExternal("https://api.netgsm.com.tr/sms/send/xml", {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=UTF-8" },
      body: xml,
      redirect: "error",
    }, { timeoutMs: PROVIDER_TIMEOUT_MS });

    if (!res.ok) {
      await discardExternalResponse(res);
      return { ok: false, code: `http_${res.status}`, error: `Netgsm HTTP ${res.status} hatası döndürdü.` };
    }
    const text = await readExternalText(res, NETGSM_MAX_RESPONSE_BYTES);
    // Netgsm başarılı yanıt: "00 JOBID" veya sadece "00"
    // Hata yanıtları: "20", "30", "40", "50", "51", "70", "85"
    const parts = text.trim().split(" ");
    const code = parts[0];

    if (code === "00") {
      return { ok: true, jobid: parts[1] };
    }

    return { ok: false, code, error: netgsmErrorMessage(code) };
  } catch {
    return { ok: false, code: "transport_error", error: "Netgsm sağlayıcısına erişilemedi." };
  }
}

function netgsmErrorMessage(code: string): string {
  const errors: Record<string, string> = {
    "20": "Mesaj metni veya gönderici adı hatalı.",
    "30": "Geçersiz kullanıcı kodu veya şifre.",
    "40": "Mesaj başlığı (header) onaylı değil.",
    "50": "Abonelik/kredi yetersiz.",
    "51": "Kredi yetersiz.",
    "70": "Hatalı sorgu (parametre eksik).",
    "85": "Filtrelenmiş numara veya İYS ret.",
  };
  return errors[code] ?? `Bilinmeyen hata kodu: ${code}`;
}
