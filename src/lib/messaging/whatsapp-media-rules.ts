/**
 * Gelen WhatsApp medyası için SAF kurallar (COM-03; testli). Sunucu indirme/yazma katmanı: whatsapp-media.ts.
 * Kova ve sınırlar migration 20261018070002_inbound_media_bucket.sql ile AYNIDIR.
 */

export const INBOUND_MEDIA_BUCKET = "inbound-media";
export const INBOUND_MEDIA_MAX_BYTES = 16 * 1024 * 1024;

/** Kovanın kabul ettiği MIME → dosya uzantısı. Liste dışı tür saklanmaz (yalnız metin özeti kalır). */
export const INBOUND_MEDIA_MIME_EXT: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
};

/** Saklanan medya kaydı: communications.provider_metadata.media[] öğesi. */
export type InboundMediaRecord = {
  path: string;
  mime: string;
  size: number;
  kind: string;
  filename: string | null;
};

/** "audio/ogg; codecs=opus" → "audio/ogg"; izinli değilse null. */
export function normalizeInboundMime(raw: string | null | undefined): string | null {
  const base = String(raw ?? "").split(";")[0]!.trim().toLowerCase();
  return INBOUND_MEDIA_MIME_EXT[base] ? base : null;
}

/** Meta'nın geçici medya adresi yalnız HTTPS ve Meta medya alan adında olabilir (SSRF kapısı). */
export function isAllowedMetaMediaUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  const host = url.hostname.toLowerCase();
  return host === "lookaside.fbsbx.com" || host.endsWith(".fbsbx.com") || host.endsWith(".whatsapp.net");
}

/** Dosya adını güvenli parçaya indirger (yol ayırıcı, boşluk, Türkçe harf → ASCII; en çok 60 karakter). */
export function safeMediaBaseName(raw: string | null | undefined): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", Ç: "c", Ğ: "g", İ: "i", Ö: "o", Ş: "s", Ü: "u" };
  const base = String(raw ?? "")
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/[çğıöşüÇĞİÖŞÜ]/g, (c) => map[c] ?? c)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "dosya";
}

/** `<ofis>/<yyyy>/<mm>/<iletişim>/<ad>.<uzantı>` (UTC ay; kiracı öneki imzalı URL kontrolünün dayanağıdır). */
export function inboundMediaPath(input: {
  tenantId: string;
  communicationId: string;
  mime: string;
  filename: string | null;
  at: Date;
}): string {
  const ext = INBOUND_MEDIA_MIME_EXT[input.mime] ?? "bin";
  const yyyy = String(input.at.getUTCFullYear());
  const mm = String(input.at.getUTCMonth() + 1).padStart(2, "0");
  return `${input.tenantId}/${yyyy}/${mm}/${input.communicationId}/${safeMediaBaseName(input.filename)}.${ext}`;
}

/** Medya türünün Türkçe kısa adı (iletişim gövdesi ve bildirim). */
export const INBOUND_MEDIA_KIND_LABEL: Readonly<Record<string, string>> = {
  image: "Fotoğraf",
  audio: "Sesli mesaj",
  video: "Video",
  document: "Belge",
  sticker: "Çıkartma",
};
