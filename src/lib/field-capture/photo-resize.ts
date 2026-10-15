/**
 * Saha fotoğrafını cihazda küçültür ve sıkıştırır (yüklemeden ÖNCE, çekim anında): uzun kenar en çok 1600 px, WebP
 * (desteklenmiyorsa JPEG). 12 MP telefon fotoğrafı ~4-6 MB'tan ~250-450 KB'a iner: çevrimdışı kuyruk cihazı doldurmaz,
 * mobil veride yükleme hızlanır. Yeniden kodlama EXIF'i (GPS konumu dahil) atar. Fotoğraflar sırayla işlenir (çağıran
 * tarafta), her bitmap hemen kapatılır: düşük bellekli Android'de sekme çökmez.
 *
 * `fitWithin` ve `outputName` saf (test edilir); `compressPhoto` tarayıcı API'si kullanır.
 */

export const FIELD_PHOTO_MAX_EDGE = 1600;
const WEBP_QUALITY = 0.8;
const JPEG_QUALITY = 0.82;

/** Oranı koruyarak uzun kenarı `max`a sığdırır (büyütmez). */
export function fitWithin(width: number, height: number, max = FIELD_PHOTO_MAX_EDGE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const long = Math.max(width, height);
  if (long <= max) return { width: Math.round(width), height: Math.round(height) };
  const scale = max / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Sunucunun ad/uzantı denetimiyle uyumlu dosya adı (`saha-3.webp`). */
export function outputName(index: number, type: string): string {
  return `saha-${index}.${type === "image/webp" ? "webp" : "jpg"}`;
}

export type CompressedPhoto = { blob: Blob; width: number; height: number; type: "image/webp" | "image/jpeg" };

type Decoded = { source: CanvasImageSource; width: number; height: number; close: () => void };

/** EXIF yönü uygulanmış çözümleme; createImageBitmap yoksa/başarısızsa <img> ile (tarayıcı yönü kendisi uygular). */
async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // eski tarayıcı ya da seçenek desteklenmiyor: <img> yolu
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(resolve, type, quality);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Fotoğrafı küçültüp sıkıştırır. Okunamayan dosyada (ör. tarayıcının açamadığı HEIC) anlaşılır hata fırlatır.
 * WebP kodlayıcı yoksa (eski Safari PNG döndürür) JPEG'e düşer.
 */
export async function compressPhoto(file: Blob): Promise<CompressedPhoto> {
  let decoded: Decoded;
  try {
    decoded = await decode(file);
  } catch {
    throw new Error("Bu fotoğraf okunamadı. Kamerada JPEG biçimini seçin ya da başka bir fotoğraf deneyin.");
  }
  try {
    const { width, height } = fitWithin(decoded.width, decoded.height);
    if (!width || !height) throw new Error("Bu fotoğraf okunamadı.");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Fotoğraf hazırlanamadı (tarayıcı belleği yetersiz).");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(decoded.source, 0, 0, width, height);
    decoded.close();
    const webp = await toBlob(canvas, "image/webp", WEBP_QUALITY);
    let out: CompressedPhoto | null = webp && webp.type === "image/webp" && webp.size > 0 ? { blob: webp, width, height, type: "image/webp" } : null;
    if (!out) {
      const jpeg = await toBlob(canvas, "image/jpeg", JPEG_QUALITY);
      if (jpeg && jpeg.size > 0) out = { blob: jpeg, width, height, type: "image/jpeg" };
    }
    // Tuvali hemen bırak (düşük bellekli cihaz).
    canvas.width = 0;
    canvas.height = 0;
    if (!out) throw new Error("Fotoğraf sıkıştırılamadı.");
    return out;
  } finally {
    decoded.close();
  }
}
