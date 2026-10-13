/**
 * Site medyası tür tespiti: türü YALNIZ BAYT İMZASINDAN belirler (dosya adı/uzantısı ve istemcinin MIME'ı yok sayılır;
 * site-menu/media.ts deseni). Kabul: JPEG, PNG, WebP, AVIF (durağan raster). SVG, HTML, video, GIF, HEIC REDDEDİLİR.
 * Çok dilli (polyglot) dosya savunması: geçerli imzalı olsa da gövdesinde işaretleme/betik/arşiv izi taşıyan dosya reddedilir
 * (ikinci savunma: sunucu her görseli sharp ile YENİDEN KODLAR, kaynak bayt hiç sunulmaz). Saf modül.
 */

export type SiteMediaType = "jpeg" | "png" | "webp" | "avif";

export const SITE_MEDIA_MIME: Record<SiteMediaType, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

export type SniffResult = { ok: true; type: SiteMediaType; mime: string } | { ok: false; error: string };

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, Math.min(to, b.length)));

/** ISO-BMFF `ftyp` kutusu: ana marka + uyumlu markalar. AVIF dizisi (avis, animasyon) ve HEIC kabul edilmez. */
function isAvif(b: Uint8Array): boolean {
  if (b.length < 16 || ascii(b, 4, 8) !== "ftyp") return false;
  const size = ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
  if (size < 16 || size > 4096 || size > b.length) return false;
  const brands = [ascii(b, 8, 12)];
  for (let off = 16; off + 4 <= size; off += 4) brands.push(ascii(b, off, off + 4));
  if (brands.includes("avis")) return false;
  return brands.includes("avif");
}

/**
 * Gövdede aranacak işaretleme/betik izleri (küçük harfe çevrilmiş latin1 metinde). Sıkıştırılmış görsel verisinde bu
 * uzun ASCII dizilerinin rastgele çıkma olasılığı ihmal edilebilir; çıkarsa dosya reddedilir (kullanıcı yeniden kaydeder).
 */
const MARKUP = ["<script", "<html", "<svg", "<iframe", "<body", "<!doctype", "<?php", "<?xml", "javascript:", "<object", "<embed"];

function polyglotReason(b: Uint8Array): string | null {
  const text = Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("latin1").toLowerCase();
  for (const m of MARKUP) if (text.includes(m)) return "Dosyanın içinde HTML/betik izi var (çok dilli dosya); yüklenemez. Görseli bir düzenleyiciden yeniden dışa aktarın.";
  // ZIP/JAR polyglot: arşiv merkez dizini sonu dosyanın son 64 KB'ında aranır.
  const tail = b.subarray(Math.max(0, b.length - 65_557));
  for (let i = 0; i + 4 <= tail.length; i++) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
      return "Dosyanın sonunda arşiv (ZIP) verisi var; yüklenemez.";
    }
  }
  return null;
}

export function sniffSiteMedia(bytes: Uint8Array): SniffResult {
  if (!bytes || bytes.length === 0) return { ok: false, error: "Dosya boş." };
  let type: SiteMediaType | null = null;
  if (bytes.length > 8 && bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) type = "png";
  else if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) type = "jpeg";
  else if (bytes.length > 16 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") type = "webp";
  else if (isAvif(bytes)) type = "avif";

  if (!type) {
    const head = Buffer.from(bytes.subarray(0, 512)).toString("utf8").trimStart().toLowerCase();
    if (head.startsWith("<svg") || head.startsWith("<?xml") || head.includes("<svg")) return { ok: false, error: "SVG kabul edilmez; PNG, JPEG, WebP veya AVIF yükleyin." };
    if (head.startsWith("<")) return { ok: false, error: "Bu dosya görsel değil (HTML/metin); dosya uzantısına bakılmaz, içerik esas alınır." };
    if (ascii(bytes, 0, 3) === "GIF") return { ok: false, error: "GIF kabul edilmez; durağan PNG, JPEG, WebP veya AVIF yükleyin." };
    if (ascii(bytes, 4, 8) === "ftyp") return { ok: false, error: "Video veya HEIC kabul edilmez; PNG, JPEG, WebP veya AVIF yükleyin." };
    return { ok: false, error: "Yalnız PNG, JPEG, WebP veya AVIF görseli yüklenebilir." };
  }
  const bad = polyglotReason(bytes);
  if (bad) return { ok: false, error: bad };
  return { ok: true, type, mime: SITE_MEDIA_MIME[type] };
}
