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
};

/**
 * WhatsApp mesajı gönderir.
 * Şu an iskelet — gerçek entegrasyon için platform_settings'te
 * whatsapp_api_url + whatsapp_api_token tanımlanmalı.
 */
export async function sendWhatsApp(
  to: string,
  text: string,
): Promise<WhatsAppSendResult> {
  const [apiUrl, apiToken] = await Promise.all([
    getPlatformSetting("whatsapp_api_url"),
    getPlatformSetting("whatsapp_api_token"),
  ]);

  const url = apiUrl ?? process.env.WHATSAPP_API_URL ?? "";
  const token = apiToken ?? process.env.WHATSAPP_API_TOKEN ?? "";

  if (!url || !token) {
    return { ok: false, error: "WhatsApp API yapılandırılmamış." };
  }

  const phone = normalizePhone(to);
  if (!phone) return { ok: false, error: "Geçersiz telefon numarası." };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: `90${phone}`,  // Uluslararası format
        type: "text",
        text: { body: text },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `API hatası: ${res.status} ${body.slice(0, 100)}` };
    }

    const data = await res.json() as { messages?: { id: string }[] };
    return { ok: true, messageId: data.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Bağlantı hatası." };
  }
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
    const res = await fetch("https://api.netgsm.com.tr/sms/send/xml", {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=UTF-8" },
      body: xml,
    });

    const text = await res.text();
    // Netgsm başarılı yanıt: "00 JOBID" veya sadece "00"
    // Hata yanıtları: "20", "30", "40", "50", "51", "70", "85"
    const parts = text.trim().split(" ");
    const code = parts[0];

    if (code === "00") {
      return { ok: true, jobid: parts[1] };
    }

    return { ok: false, code, error: netgsmErrorMessage(code) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Bağlantı hatası." };
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
