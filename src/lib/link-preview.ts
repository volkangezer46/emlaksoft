import { HTML_LIMITED_BOTS } from "@/lib/seo/html-limited-bots";

/**
 * Bağlantı önizleme isteği ayrımı — TEK KAYNAK (SK8 B150).
 *
 * NEDEN: token'lı müşteri linkleri (paylaşım, sunum, malik/müşteri portalı, tavsiye) ana olarak WhatsApp/Telegram ile
 * gider. Önizleyici sayfanın HTML'ini çerezsiz çeker; süzgeç olmazsa bu istek görüntülenme sayacını artırır, "son
 * görülme" alanını günceller ve "linkiniz açıldı" bildirimini müşteri linki açmadan gönderir. Kural: token yüzeyinde
 * YAN ETKİ yazan her çağrı (sayaç, last_seen_at, bildirim, tıklama) önce bu kapıdan geçer; bot isteğinde hiçbir yan
 * etki olmaz (sözleşme: `src/lib/public-surfaces-contract.test.ts`).
 *
 * Eşleşenler: Next'in HTML-limited bot listesi (WhatsApp, facebookexternalhit, Twitterbot, Slackbot, Discordbot…) +
 * listede olmayan önizleyiciler (TelegramBot, Viber, Skype…) + genel bot/crawler/spider imzası + boş UA + tarayıcı
 * ön-yüklemesi/ön-işlemesi (`Sec-Purpose: prefetch|prerender`). İnsan tarayıcısı eşleşmez.
 */
const EXTRA_PREVIEW_BOTS = /TelegramBot|Viber|SkypeUriPreview|Snapchat|Pinterest|Embedly|Iframely|HeadlessChrome|\bbot\b|bot\/|crawler|spider|preview|curl\/|wget\/|python-requests|okhttp|Go-http-client|node-fetch|axios\//i;

export function isLinkPreviewRequest(userAgent: string | null | undefined, purpose?: string | null): boolean {
  if (purpose && /prefetch|prerender/i.test(purpose)) return true;
  const ua = String(userAgent ?? "").trim();
  if (!ua) return true;
  return HTML_LIMITED_BOTS.test(ua) || EXTRA_PREVIEW_BOTS.test(ua);
}

/** `headers()` sonucundan (UA + Sec-Purpose/Purpose) önizleme isteği mi? Sunucu bileşenleri bunu çağırır. */
export function isLinkPreviewHeaders(h: Pick<Headers, "get">): boolean {
  return isLinkPreviewRequest(h.get("user-agent"), h.get("sec-purpose") ?? h.get("purpose"));
}
