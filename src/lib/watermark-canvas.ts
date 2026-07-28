/**
 * Filigran çizimi — TARAYICI tarafı (canvas). Saf matematik `@/lib/watermark`.
 *
 * Neden sunucuda değil: proje Vercel'de çalışıyor ve `sharp` gibi native bir
 * görüntü işleme bağımlılığı yok; damgalama yükleme anında istemcide yapılır.
 * Sonuç: kullanıcının diskindeki ORİJİNAL dosya bozulmaz, storage'a yalnızca
 * damgalanmış kopya gider.
 *
 * Logo & CORS: logo `tenant-logos` (public read) bucket'ından gelir ve Supabase
 * public URL'leri `Access-Control-Allow-Origin: *` döner. Yine de üçüncü parti
 * bir logo URL'i veya CORS başlığı kaybolmuş bir kurulum canvas'ı "taint"
 * etmesin diye görsel HER ZAMAN `crossOrigin="anonymous"` ile yüklenir: başlık
 * yoksa yükleme HATA verir (sessiz taint yerine), biz de metin moduna düşeriz.
 * Böylece `toBlob()` asla SecurityError atmaz.
 */

import {
  computeWatermarkBox,
  type WatermarkSettings,
} from "@/lib/watermark";

/** Filigran metninin çizildiği referans punto (mark canvas doğal ölçeği). */
const TEXT_PX = 96;
const TEXT_FONT = `800 ${TEXT_PX}px "Segoe UI", system-ui, -apple-system, sans-serif`;
const PAD = 24;

/**
 * Logoyu CORS-güvenli yükler. Başarısızlıkta `null` — çağıran metin moduna düşer.
 */
export function loadWatermarkLogo(url: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img.naturalWidth > 0 ? img : null);
    img.onerror = () => resolve(null);
    img.src = url;
    // Bozuk/çok yavaş CDN yüklemeyi kilitlemesin — 8 sn sonra metne düş.
    window.setTimeout(() => resolve(img.complete && img.naturalWidth > 0 ? img : null), 8000);
  });
}

export type MarkSources = {
  logo?: HTMLImageElement | null;
  /** Ayardaki metin boşsa ofis adı */
  text?: string | null;
};

/** Ayar + eldeki kaynaklara göre gerçekten uygulanacak modu belirler. */
export function effectiveWatermarkMode(
  settings: WatermarkSettings,
  sources: MarkSources,
): "logo" | "text" | "both" | null {
  const hasLogo = Boolean(sources.logo);
  const hasText = Boolean((sources.text ?? "").trim());
  if (settings.mode === "logo") return hasLogo ? "logo" : hasText ? "text" : null;
  if (settings.mode === "text") return hasText ? "text" : hasLogo ? "logo" : null;
  if (hasLogo && hasText) return "both";
  if (hasLogo) return "logo";
  if (hasText) return "text";
  return null;
}

/**
 * Filigranın kendisini (logo ve/veya metin) doğal çözünürlükte bir offscreen
 * canvas'a çizer. Hedef görselden bağımsızdır; ölçekleme `computeWatermarkBox`
 * ile tek noktadan yapılır.
 */
export function buildMarkCanvas(
  settings: WatermarkSettings,
  sources: MarkSources,
): HTMLCanvasElement | null {
  const mode = effectiveWatermarkMode(settings, sources);
  if (!mode) return null;

  const text = (sources.text ?? "").trim();
  const logo = sources.logo ?? null;

  // Metin ölçümü için geçici bağlam
  const meter = document.createElement("canvas").getContext("2d");
  if (!meter) return null;
  meter.font = TEXT_FONT;
  const textW = mode === "logo" ? 0 : Math.ceil(meter.measureText(text).width);
  const textH = mode === "logo" ? 0 : Math.ceil(TEXT_PX * 1.25);

  // Logo, metinle birlikteyken metin genişliğine yakın bir orana getirilir
  let logoW = 0;
  let logoH = 0;
  if (mode !== "text" && logo) {
    const ratio = logo.naturalHeight / logo.naturalWidth;
    logoW = mode === "both" ? Math.max(textW, TEXT_PX * 3) : Math.max(logo.naturalWidth, 1);
    logoH = Math.max(1, Math.round(logoW * ratio));
  }

  const gap = mode === "both" ? Math.round(TEXT_PX * 0.28) : 0;
  const w = Math.max(1, Math.max(logoW, textW) + PAD * 2);
  const h = Math.max(1, logoH + (mode === "both" ? gap : 0) + textH + PAD * 2);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  let y = PAD;
  if (logoW > 0 && logo) {
    ctx.drawImage(logo, Math.round((w - logoW) / 2), y, logoW, logoH);
    y += logoH + gap;
  }
  if (textW > 0) {
    ctx.font = TEXT_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    // Hem açık hem koyu fotoğrafta okunsun: koyu kontur + beyaz gövde
    ctx.lineWidth = Math.max(2, TEXT_PX * 0.09);
    ctx.strokeStyle = "rgba(10, 12, 20, 0.55)";
    ctx.lineJoin = "round";
    ctx.strokeText(text, w / 2, y);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, w / 2, y);
  }

  return canvas;
}

/**
 * Hazır bir mark canvas'ını hedef bağlama, ayardaki konum/ölçek/şeffaflıkla basar.
 * `imgW/imgH` hedef görselin PİKSEL ölçüsüdür (önizlemede canvas ölçüsü).
 */
export function drawWatermarkOnContext(
  ctx: CanvasRenderingContext2D,
  imgW: number,
  imgH: number,
  mark: HTMLCanvasElement,
  settings: WatermarkSettings,
): void {
  const box = computeWatermarkBox({
    imgW,
    imgH,
    markW: mark.width,
    markH: mark.height,
    position: settings.position,
    scale: settings.scale,
    marginPct: settings.marginPct,
  });
  if (box.w <= 0 || box.h <= 0) return;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = Math.max(0, Math.min(1, settings.opacity / 100));
  ctx.drawImage(mark, box.x, box.y, box.w, box.h);
  ctx.globalAlpha = prev;
}

export type WatermarkApplyResult = {
  file: File;
  /** Damga gerçekten basıldı mı (kapalı ayar / kaynak yok / hata → false) */
  applied: boolean;
};

/** Canvas'a çizilebilen görsel tipleri (GIF animasyonu bozulmasın diye hariç). */
const STAMPABLE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Yüklenecek dosyaya filigran basar. Başarısız her durumda ORİJİNAL dosya ve
 * `applied: false` döner — filigran yüzünden yükleme asla kırılmaz.
 */
export async function applyWatermarkToFile(
  original: File,
  settings: WatermarkSettings,
  sources: MarkSources,
): Promise<WatermarkApplyResult> {
  if (!settings.enabled) return { file: original, applied: false };
  if (!STAMPABLE_TYPES.includes(original.type)) return { file: original, applied: false };

  let bitmap: ImageBitmap | null = null;
  try {
    const mark = buildMarkCanvas(settings, sources);
    if (!mark) return { file: original, applied: false };

    bitmap = await createImageBitmap(original, { imageOrientation: "from-image" });
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { file: original, applied: false };

    ctx.drawImage(bitmap, 0, 0);
    drawWatermarkOnContext(ctx, canvas.width, canvas.height, mark, settings);

    // PNG şeffaflığı korunur; diğerleri JPEG'e sıkıştırılır (boyutlandırma ile aynı kural)
    const outType = original.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outType, 0.9));
    if (!blob) return { file: original, applied: false };

    const name =
      outType === "image/jpeg" ? original.name.replace(/\.[^.]+$/, "") + ".jpg" : original.name;
    return { file: new File([blob], name, { type: outType }), applied: true };
  } catch {
    return { file: original, applied: false };
  } finally {
    bitmap?.close();
  }
}
