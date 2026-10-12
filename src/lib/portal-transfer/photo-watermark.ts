import { computeWatermarkBox, sanitizeWatermarkSettings, type WatermarkSettings } from "@/lib/watermark";

/**
 * Portala giden fotoğraflara OFİS FİLİGRANI. Projede sunucuda görüntü işleme (sharp) yoktur; filigran bilinçli olarak
 * tarayıcıda canvas ile basılır (`watermark-canvas.ts`, yükleme anı). Aktarımda fotoğrafları eklentinin içerik betiği
 * indirip küçülttüğü için damga da orada, AYNI saf matematikle (`computeWatermarkBox`) basılır; orijinal dosya ve
 * EmlakSoft'taki kayıt değişmez. Ayar yalnız kiracının kendi kaydından (RLS + tenant eşitliği) sunucuda okunur ve aktarım
 * paketiyle gelir; ayar kapalıysa `null` döner ve fotoğraf olduğu gibi gider.
 */

export type TransferWatermark = {
  settings: WatermarkSettings;
  /** Ofis logosu (yalnız https); yüklenemezse metne düşülür. */
  logoUrl: string | null;
  /** Basılacak metin: ayardaki metin, boşsa ofis adı. */
  text: string;
};

/** `tenants` satırından aktarım filigranı; kapalı/bozuk ayarda null. */
export function transferWatermarkFromTenant(row: { name?: unknown; logo_url?: unknown; watermark_settings?: unknown } | null | undefined): TransferWatermark | null {
  if (!row) return null;
  const settings = sanitizeWatermarkSettings(row.watermark_settings ?? null);
  if (!settings.enabled) return null;
  const logo = typeof row.logo_url === "string" && /^https:\/\//i.test(row.logo_url) ? row.logo_url : null;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const text = (settings.text ?? "").trim() || name;
  // Basılacak hiçbir şey yoksa (logo yok, metin yok) filigran uygulanmaz.
  if (!logo && !text) return null;
  return { settings, logoUrl: logo, text };
}

/** Eklentiye gelen (güvenilmeyen) paketten filigranı doğrular. */
export function sanitizeTransferWatermark(raw: unknown): TransferWatermark | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as { settings?: unknown; logoUrl?: unknown; text?: unknown };
  const settings = sanitizeWatermarkSettings(r.settings);
  if (!settings.enabled) return null;
  const logoUrl = typeof r.logoUrl === "string" && /^https:\/\//i.test(r.logoUrl) ? r.logoUrl : null;
  const text = typeof r.text === "string" ? r.text.trim().slice(0, 80) : "";
  if (!logoUrl && !text) return null;
  return { settings, logoUrl, text };
}

/** Logo ve metin eldeyken gerçekte uygulanacak mod (watermark-canvas ile aynı kural). */
export function effectiveTransferMode(mode: WatermarkSettings["mode"], hasLogo: boolean, hasText: boolean): "logo" | "text" | "both" | null {
  if (mode === "logo") return hasLogo ? "logo" : hasText ? "text" : null;
  if (mode === "text") return hasText ? "text" : hasLogo ? "logo" : null;
  if (hasLogo && hasText) return "both";
  if (hasLogo) return "logo";
  if (hasText) return "text";
  return null;
}

const TEXT_PX = 96;
const PAD = 24;
const FONT = `800 ${TEXT_PX}px "Segoe UI", system-ui, -apple-system, sans-serif`;

/** Filigran kaynağını (logo + metin) doğal çözünürlükte bir OffscreenCanvas'a çizer. */
export function buildTransferMark(wm: TransferWatermark, logo: ImageBitmap | null): OffscreenCanvas | null {
  const mode = effectiveTransferMode(wm.settings.mode, Boolean(logo), Boolean(wm.text));
  if (!mode) return null;
  const meter = new OffscreenCanvas(1, 1).getContext("2d");
  if (!meter) return null;
  meter.font = FONT;
  const textW = mode === "logo" ? 0 : Math.ceil(meter.measureText(wm.text).width);
  const textH = mode === "logo" ? 0 : Math.ceil(TEXT_PX * 1.25);
  let logoW = 0;
  let logoH = 0;
  if (mode !== "text" && logo) {
    const ratio = logo.height / Math.max(1, logo.width);
    logoW = mode === "both" ? Math.max(textW, TEXT_PX * 3) : Math.max(logo.width, 1);
    logoH = Math.max(1, Math.round(logoW * ratio));
  }
  const gap = mode === "both" ? Math.round(TEXT_PX * 0.28) : 0;
  const w = Math.max(1, Math.max(logoW, textW) + PAD * 2);
  const h = Math.max(1, logoH + (mode === "both" ? gap : 0) + textH + PAD * 2);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  let y = PAD;
  if (logoW > 0 && logo) {
    ctx.drawImage(logo, Math.round((w - logoW) / 2), y, logoW, logoH);
    y += logoH + gap;
  }
  if (textW > 0) {
    ctx.font = FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineWidth = Math.max(2, TEXT_PX * 0.09);
    ctx.strokeStyle = "rgba(10, 12, 20, 0.55)";
    ctx.lineJoin = "round";
    ctx.strokeText(wm.text, w / 2, y);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(wm.text, w / 2, y);
  }
  return canvas;
}

/** Hazır filigranı hedef bağlama ayardaki konum/ölçek/şeffaflıkla basar. */
export function stampTransferMark(ctx: OffscreenCanvasRenderingContext2D, imgW: number, imgH: number, mark: OffscreenCanvas, settings: WatermarkSettings): void {
  const box = computeWatermarkBox({ imgW, imgH, markW: mark.width, markH: mark.height, position: settings.position, scale: settings.scale, marginPct: settings.marginPct });
  if (box.w <= 0 || box.h <= 0) return;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = Math.max(0, Math.min(1, settings.opacity / 100));
  ctx.drawImage(mark, box.x, box.y, box.w, box.h);
  ctx.globalAlpha = prev;
}
