/**
 * Kanal sınıflandırıcı (SAF, sunucu-istemci ortak). Ziyaret ve kayıt AYNI kuralla kanala ayrılır.
 *
 * Öncelik: (1) EmlakSoft'un kendi atıf dokunuşu (ofis daveti, ortak, vitrin imzası) → (2) UTM etiketi →
 * (3) yönlendiren ana makine (yalnız host; yol/sorgu hiç gelmez) → (4) hiçbiri yoksa "direct".
 * Bilgi hiç taşınmadıysa (`refHost` undefined/null VE UTM yok) sonuç "unknown"dır: "doğrudan" ile "bilmiyoruz"
 * karıştırılmaz. Kendi alan adımız ve vitrin (aynı alan adı altında) "direct" sayılır.
 */
import type { RefTouch } from "@/lib/growth/attribution";

export const CHANNELS = [
  "paid_search",
  "organic_search",
  "social",
  "referral_site",
  "direct",
  "email",
  "office_invite",
  "partner",
  "vitrin_signature",
  "unknown",
] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABEL: Record<Channel | "bilinmiyor", string> = {
  paid_search: "Ücretli arama",
  organic_search: "Organik arama",
  social: "Sosyal medya",
  referral_site: "Başka site",
  direct: "Doğrudan",
  email: "E-posta",
  office_invite: "Ofis daveti",
  partner: "İş ortağı",
  vitrin_signature: "Vitrin imzası",
  unknown: "Belirsiz",
  bilinmiyor: "Atıfsız kayıt",
};

export function isChannel(v: unknown): v is Channel {
  return typeof v === "string" && (CHANNELS as readonly string[]).includes(v);
}

export type ChannelInput = {
  /** Yönlendiren ana makine. "" = yönlendiren yok (bilinen); null/undefined = bilgi taşınmadı. */
  refHost?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  touch?: Pick<RefTouch, "kind"> | null;
  /** Kendi alan adlarımız (varsayılan: emlaksoft.com.tr ve alt alan adları). */
  ownHosts?: readonly string[];
};

export const DEFAULT_OWN_HOSTS: readonly string[] = ["emlaksoft.com.tr", "emlaksoft.vercel.app", "localhost"];

const PAID_MEDIUM = /^(cpc|ppc|paid|paidsearch|paid-search|paid_search|sem|ads|cpm|display|adwords|google-ads|googleads)$/;
const EMAIL_MEDIUM = /^(email|e-mail|e_mail|mail|newsletter|bulten|bülten)$/;
const SOCIAL_MEDIUM = /^(social|social-media|social_media|sosyal|paid-social|paid_social|paidsocial|sm)$/;
const REFERRAL_MEDIUM = /^(referral|ref|link|partner-site)$/;
const ORGANIC_MEDIUM = /^(organic|seo)$/;

const SEARCH_SOURCE = /^(google|bing|yandex|duckduckgo|yahoo|ecosia|baidu|naver|brave|qwant|startpage|yaani)$/;
const SOCIAL_SOURCE = /^(facebook|fb|instagram|ig|twitter|x|linkedin|youtube|tiktok|pinterest|whatsapp|telegram|threads|reddit)$/;
const EMAIL_SOURCE = /^(email|newsletter|bulten|mailchimp|sendgrid|brevo)$/;

const SEARCH_HOST = /(^|\.)(google\.[a-z.]+|bing\.com|yandex\.[a-z.]+|ya\.ru|duckduckgo\.com|search\.yahoo\.com|yahoo\.com|ecosia\.org|search\.brave\.com|baidu\.com|naver\.com|qwant\.com|startpage\.com|yaani\.com\.tr)$/;
const MAIL_HOST = /(^|\.)(mail\.google\.com|outlook\.live\.com|outlook\.office\.com|outlook\.office365\.com|mail\.yahoo\.com|mail\.yandex\.[a-z.]+|mail\.ru)$/;
const SOCIAL_HOST =
  /(^|\.)(facebook\.com|fb\.com|fb\.me|instagram\.com|t\.co|x\.com|twitter\.com|linkedin\.com|lnkd\.in|youtube\.com|youtu\.be|tiktok\.com|pinterest\.[a-z.]+|pin\.it|reddit\.com|threads\.net|whatsapp\.com|wa\.me|t\.me|telegram\.org)$/;

/** Ana makineyi küçük harfe indirger, port ve sondaki noktayı atar; geçersizse "". */
export function cleanHost(raw: string | null | undefined): string {
  const h = (raw ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  return h.length <= 100 && /^[a-z0-9.-]+$/.test(h) ? h : "";
}

function isOwnHost(host: string, own: readonly string[]): boolean {
  return own.some((o) => host === o || host.endsWith(`.${o}`));
}

export function classifyChannel(input: ChannelInput): Channel {
  const kind = input.touch?.kind;
  if (kind === "referral") return "office_invite";
  if (kind === "partner") return "partner";
  if (kind === "powered_by") return "vitrin_signature";

  const medium = (input.utm_medium ?? "").trim().toLowerCase();
  const source = (input.utm_source ?? "").trim().toLowerCase();
  if (medium || source) {
    if (PAID_MEDIUM.test(medium)) return "paid_search";
    if (EMAIL_MEDIUM.test(medium)) return "email";
    if (SOCIAL_MEDIUM.test(medium)) return "social";
    if (ORGANIC_MEDIUM.test(medium)) return SOCIAL_SOURCE.test(source) ? "social" : "organic_search";
    if (REFERRAL_MEDIUM.test(medium)) return "referral_site";
    if (!medium) {
      if (SOCIAL_SOURCE.test(source)) return "social";
      if (EMAIL_SOURCE.test(source)) return "email";
      if (SEARCH_SOURCE.test(source)) return "organic_search";
    }
    return "unknown";
  }

  if (input.refHost === null || input.refHost === undefined) return "unknown";
  const host = cleanHost(input.refHost);
  if (!host) return "direct";
  if (isOwnHost(host, input.ownHosts ?? DEFAULT_OWN_HOSTS)) return "direct";
  if (MAIL_HOST.test(host)) return "email";
  if (SEARCH_HOST.test(host)) return "organic_search";
  if (SOCIAL_HOST.test(host)) return "social";
  return "referral_site";
}
