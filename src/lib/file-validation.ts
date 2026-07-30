/**
 * Yüklenen görsellerin GERÇEK içeriğini (magic byte / dosya imzası) doğrular.
 *
 * NEDEN: `File.type` (MIME) tarayıcı/istemci tarafından bildirilir ve KOLAYCA
 * spoof edilir — saldırgan bir HTML/SVG/script dosyasını `image/png` diye
 * gönderebilir. İçerik imzasını doğrulamak, kılık değiştirmiş dosyaları ve
 * SVG-XSS'i (SVG bir görsel imzası taşımaz) baştan eler. Sunucuda çağrılır.
 */

export type DetectedImage = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

/** İlk baytlardan görsel türünü tespit eder; tanınmazsa null. */
export function detectImageType(bytes: Uint8Array): DetectedImage | null {
  if (bytes.length < 12) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  // GIF: 47 49 46 38 ("GIF8")
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";
  // WebP: "RIFF"...."WEBP"
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export type VerifyResult = { ok: true; type: DetectedImage } | { ok: false; error: string };

/**
 * Dosyanın imzası GERÇEKTEN izin verilen görsel türlerinden biri mi.
 * `allowed` MIME listesiyle kesişim aranır (ör. SVG hiçbir imza taşımadığı için
 * asla geçmez — SVG-XSS engellenmiş olur).
 */
export async function verifyImageFile(file: File, allowed: readonly string[]): Promise<VerifyResult> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const detected = detectImageType(head);
  if (!detected) return { ok: false, error: "Dosya geçerli bir görsel değil (imza doğrulanamadı)." };
  if (!allowed.includes(detected)) return { ok: false, error: "Desteklenmeyen görsel türü." };
  return { ok: true, type: detected };
}
