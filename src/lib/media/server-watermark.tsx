import "server-only";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { computeWatermarkBox, type WatermarkSettings } from "@/lib/watermark";

/**
 * Sunucu tarafı filigran (toplu ZIP indirme, PF-09). Yükleme anındaki istemci damgasıyla (watermark-canvas.ts) aynı
 * ayar ve aynı geometri (`computeWatermarkBox`): konum, ölçek, kenar boşluğu, şeffaflık. Yalnız yüklenirken
 * DAMGALANMAMIŞ görsellere uygulanır (çift damga olmaz); depodaki dosya değişmez, yalnız ZIP'teki kopya damgalanır.
 *
 * Filigranın kendisi (logo ve/veya metin) bir kez `next/og` ile PNG'ye çizilir: sunucu imajında sistem yazı tipi yok,
 * `next/og` kendi yazı tipini taşır (Türkçe harfler OG kartlarında da böyle basılıyor). Saydam kenarlar `trim` ile
 * atılır, her görselde yalnız `sharp` ile ölçeklenip bindirilir.
 */

const TEXT_PX = 96;
const PAD = 24;
/** Çok büyük kaynakta işlem sınırı (sharp varsayılanından düşük; ilan görseli 2048 px'e küçültülüyor). */
const LIMIT_INPUT_PIXELS = 60_000_000;

export type ServerMarkSources = { text?: string | null; logo?: { data: Buffer; width: number; height: number } | null };

/** Ayardaki moda ve eldeki kaynaklara göre uygulanacak mod (istemci `effectiveWatermarkMode` ile aynı kural). */
export function resolveMarkMode(
  mode: WatermarkSettings["mode"],
  hasLogo: boolean,
  hasText: boolean,
): "logo" | "text" | "both" | null {
  if (mode === "logo") return hasLogo ? "logo" : hasText ? "text" : null;
  if (mode === "text") return hasText ? "text" : hasLogo ? "logo" : null;
  if (hasLogo && hasText) return "both";
  if (hasLogo) return "logo";
  if (hasText) return "text";
  return null;
}

/** Logoyu PNG'ye çevirip ölçüsünü verir; bozuk logo → null (metne düşülür). */
export async function prepareLogo(data: Buffer | null | undefined): Promise<ServerMarkSources["logo"]> {
  if (!data || data.length === 0) return null;
  try {
    const { data: png, info } = await sharp(data, { limitInputPixels: 16_000_000 })
      .rotate()
      .resize({ width: 600, height: 600, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    return info.width > 0 && info.height > 0 ? { data: png, width: info.width, height: info.height } : null;
  } catch {
    return null;
  }
}

/**
 * Filigran PNG'si (saydam zemin, doğal ölçek). Mod yoksa (ne logo ne metin) null.
 */
export async function buildWatermarkMark(settings: WatermarkSettings, sources: ServerMarkSources): Promise<Buffer | null> {
  const text = (sources.text ?? "").trim().slice(0, 80);
  const logo = sources.logo ?? null;
  const mode = resolveMarkMode(settings.mode, Boolean(logo), Boolean(text));
  if (!mode) return null;

  const showText = mode !== "logo";
  const showLogo = mode !== "text" && logo;
  // Metin genişliği ölçülemez (DOM yok) → cömert tahmin; fazlası saydamdır ve trim ile atılır.
  const textW = showText ? Math.ceil(Array.from(text).length * TEXT_PX * 0.68) : 0;
  const textH = showText ? Math.ceil(TEXT_PX * 1.3) : 0;
  const logoW = showLogo ? (mode === "both" ? Math.max(Math.min(textW, 900), TEXT_PX * 3) : logo.width) : 0;
  const logoH = showLogo ? Math.max(1, Math.round((logoW * logo.height) / logo.width)) : 0;
  const gap = mode === "both" ? Math.round(TEXT_PX * 0.28) : 0;
  const width = Math.min(4000, Math.max(1, Math.max(logoW, textW) + PAD * 2));
  const height = Math.min(2000, Math.max(1, logoH + gap + textH + PAD * 2));

  const response = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
        }}
      >
        {showLogo ? (
          // eslint-disable-next-line @next/next/no-img-element -- next/og (satori) yalnız <img> çizer
          <img
            src={`data:image/png;base64,${logo.data.toString("base64")}`}
            width={logoW}
            height={logoH}
            alt=""
            style={{ marginBottom: gap }}
          />
        ) : null}
        {showText ? (
          <div
            style={{
              display: "flex",
              fontSize: TEXT_PX,
              fontWeight: 800,
              color: "#ffffff",
              whiteSpace: "nowrap",
              textShadow: "0 0 8px rgba(10,12,20,0.6), 0 2px 4px rgba(10,12,20,0.55)",
            }}
          >
            {text}
          </div>
        ) : null}
      </div>
    ),
    { width, height },
  );
  const raw = Buffer.from(await response.arrayBuffer());
  try {
    return await sharp(raw).trim({ threshold: 1 }).extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  } catch {
    return raw;
  }
}

/** Görsele hazır filigranı basar. Desteklenmeyen tür (GIF) / bozuk görsel → null (çağıran orijinali koyar). */
export async function stampImage(
  data: Uint8Array,
  fileType: string | null | undefined,
  mark: Buffer,
  settings: WatermarkSettings,
): Promise<Buffer | null> {
  const type = (fileType ?? "").toLowerCase();
  if (type !== "image/jpeg" && type !== "image/png" && type !== "image/webp") return null;
  try {
    const input = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const meta = await sharp(input, { limitInputPixels: LIMIT_INPUT_PIXELS }).metadata();
    const rotated = (meta.orientation ?? 1) >= 5;
    const imgW = (rotated ? meta.height : meta.width) ?? 0;
    const imgH = (rotated ? meta.width : meta.height) ?? 0;
    const markMeta = await sharp(mark).metadata();
    const box = computeWatermarkBox({
      imgW,
      imgH,
      markW: markMeta.width ?? 1,
      markH: markMeta.height ?? 1,
      position: settings.position,
      scale: settings.scale,
      marginPct: settings.marginPct,
    });
    if (box.w <= 0 || box.h <= 0) return null;
    const alpha = Math.max(0, Math.min(1, settings.opacity / 100));
    const scaled = await sharp(mark)
      .resize(box.w, box.h, { fit: "fill" })
      .ensureAlpha()
      // Şeffaflık: alfa kanalı ayar oranıyla çarpılır.
      .linear([1, 1, 1, alpha], [0, 0, 0, 0])
      .png()
      .toBuffer();
    const pipeline = sharp(input, { limitInputPixels: LIMIT_INPUT_PIXELS })
      .rotate()
      .composite([{ input: scaled, left: Math.max(0, box.x), top: Math.max(0, box.y) }]);
    if (type === "image/png") return await pipeline.png().toBuffer();
    if (type === "image/webp") return await pipeline.webp({ quality: 90 }).toBuffer();
    return await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  } catch {
    return null;
  }
}
