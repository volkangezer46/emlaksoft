import { validateBrandSvg } from "@/lib/brand/svg-sanitizer";
import { hasPngSignature, readPngSize } from "@/lib/brand/upload-validation";
import type { MediaKind } from "./schema";

/**
 * Site menüsü medya yüklemesi: türü BAYT İÇERİĞİNDEN belirler (istemcinin MIME'ına güvenilmez), boyut/ölçü
 * sınırlarını uygular. SVG, marka yüklemesiyle AYNI katı izin listesinden geçer (betik/foreignObject/dış kaynak
 * dosyayı reddeder) ve yalnız <img> ile sunulur. Saf modül (test edilebilir).
 */

export type MediaType = "svg" | "png" | "apng" | "webp" | "gif" | "webm" | "mp4";
export type MediaRole = "icon" | "image" | "featured";

export const MEDIA_LIMITS = {
  svgBytes: 100 * 1024,
  /** Durağan raster (PNG/WebP): ikon, poster, durağan görsel. */
  stillBytes: 400 * 1024,
  iconBytes: 200 * 1024,
  /** Animasyonlu GIF/WebP/APNG ve kısa video döngüsü. */
  motionBytes: 2 * 1024 * 1024,
  minSide: 16,
  maxSide: 2048,
  /** Aynı anda saklanabilecek en çok medya dosyası (depo satırları küçük kalsın). */
  maxAssets: 24,
} as const;

export const MEDIA_MIME: Record<MediaType, string> = {
  svg: "image/svg+xml; charset=utf-8",
  png: "image/png",
  apng: "image/apng",
  webp: "image/webp",
  gif: "image/gif",
  webm: "video/webm",
  mp4: "video/mp4",
};

export type MediaCheck =
  | { ok: true; type: MediaType; kind: MediaKind; bytes: number; w: number | null; h: number | null; data: string; encoding: "text" | "base64" }
  | { ok: false; error: string };

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.slice(from, to));

function pngIsAnimated(b: Uint8Array): boolean {
  // Parçaları gez; IDAT'tan önce acTL varsa APNG.
  let off = 8;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  while (off + 8 <= b.length) {
    const len = v.getUint32(off);
    const type = ascii(b, off + 4, off + 8);
    if (type === "acTL") return true;
    if (type === "IDAT" || type === "IEND") return false;
    off += 12 + len;
  }
  return false;
}

function webpInfo(b: Uint8Array): { animated: boolean; w: number | null; h: number | null } {
  const chunk = ascii(b, 12, 16);
  if (chunk === "VP8X" && b.length >= 30) {
    const animated = (b[20] & 0x02) !== 0;
    const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
    const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
    return { animated, w, h };
  }
  if (chunk === "VP8L" && b.length >= 25 && b[20] === 0x2f) {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { animated: false, w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 " && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return { animated: false, w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff };
  }
  return { animated: false, w: null, h: null };
}

function b64(b: Uint8Array) {
  return Buffer.from(b).toString("base64");
}

function sideCheck(w: number | null, h: number | null, role: MediaRole): string | null {
  if (w === null || h === null) return null;
  if (w < MEDIA_LIMITS.minSide || h < MEDIA_LIMITS.minSide) return `Görsel en az ${MEDIA_LIMITS.minSide}x${MEDIA_LIMITS.minSide} piksel olmalı.`;
  if (w > MEDIA_LIMITS.maxSide || h > MEDIA_LIMITS.maxSide) return `Görsel en fazla ${MEDIA_LIMITS.maxSide}x${MEDIA_LIMITS.maxSide} piksel olabilir.`;
  if (role === "icon" && (w > 512 || h > 512)) return "Logo/ikon en fazla 512x512 piksel olmalı.";
  return null;
}

export function checkMenuMedia(role: MediaRole, bytes: Uint8Array): MediaCheck {
  if (bytes.length === 0) return { ok: false, error: "Dosya boş." };
  const fail = (error: string): MediaCheck => ({ ok: false, error });
  const staticCap = role === "icon" ? MEDIA_LIMITS.iconBytes : MEDIA_LIMITS.stillBytes;
  const kb = (n: number) => (n >= 1024 * 1024 ? `${n / 1024 / 1024} MB` : `${Math.round(n / 1024)} KB`);

  let type: MediaType | null = null;
  let kind: MediaKind = "image";
  let w: number | null = null;
  let h: number | null = null;

  if (hasPngSignature(bytes)) {
    const size = readPngSize(bytes);
    if (!size) return fail("PNG başlığı okunamadı; dosya bozuk.");
    w = size.w;
    h = size.h;
    if (pngIsAnimated(bytes)) {
      type = "apng";
      kind = "animated";
    } else type = "png";
  } else if (bytes.length > 12 && ascii(bytes, 0, 3) === "GIF" && (ascii(bytes, 3, 6) === "89a" || ascii(bytes, 3, 6) === "87a")) {
    type = "gif";
    kind = "animated";
    w = bytes[6] | (bytes[7] << 8);
    h = bytes[8] | (bytes[9] << 8);
  } else if (bytes.length > 30 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    const info = webpInfo(bytes);
    type = "webp";
    kind = info.animated ? "animated" : "image";
    w = info.w;
    h = info.h;
  } else if (bytes.length > 64 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    type = "webm";
    kind = "video";
  } else if (bytes.length > 64 && ascii(bytes, 4, 8) === "ftyp") {
    type = "mp4";
    kind = "video";
  }

  if (type) {
    if (role !== "featured" && kind !== "image") {
      return fail(role === "icon" ? "Logo/ikon durağan olmalı (SVG, PNG veya WebP)." : "Bu alan için durağan görsel (SVG, PNG veya WebP) gerekir.");
    }
    const cap = kind === "image" ? staticCap : MEDIA_LIMITS.motionBytes;
    if (bytes.length > cap) return fail(`Dosya en fazla ${kb(cap)} olabilir (bu dosya ${kb(bytes.length)}).`);
    const bad = sideCheck(w, h, role);
    if (bad) return fail(bad);
    return { ok: true, type, kind, bytes: bytes.length, w, h, data: b64(bytes), encoding: "base64" };
  }

  // İmza yok -> SVG metni olmalı; ikili içerik reddedilir.
  if (bytes.length > MEDIA_LIMITS.svgBytes) return fail(`SVG en fazla ${kb(MEDIA_LIMITS.svgBytes)} olabilir.`);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("Yalnız SVG, PNG, WebP, GIF, APNG, WebM veya MP4 yüklenebilir.");
  }
  const res = validateBrandSvg(text, MEDIA_LIMITS.svgBytes);
  if (!res.ok) return fail(res.error);
  return { ok: true, type: "svg", kind: "image", bytes: Buffer.byteLength(res.svg, "utf8"), w: null, h: null, data: res.svg, encoding: "text" };
}

export const MEDIA_ID_RE = /^[a-f0-9]{12}$/;
