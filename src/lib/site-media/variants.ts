import "server-only";
import { randomBytes } from "node:crypto";
import sharp, { type Metadata } from "sharp";
import type { SiteMediaType } from "./sniff";
import { SITE_MEDIA_LIMITS } from "./quota";
import type { MediaVariant, VariantFormat } from "./types";

/**
 * Görsel işleme (yalnız sunucu, sharp): kaynak YENİDEN KODLANIR, hiçbir kaynak bayt sunulmaz.
 *   - EXIF yönü uygulanır, ardından TÜM üst veri (EXIF/GPS/ICC dışı) atılır (sharp varsayılanı: üst veri yazılmaz).
 *   - 480/960/1600 genişlikte AVIF + WebP (kaynaktan küçükse kaynak genişliği; büyütme yok).
 *   - LQIP: küçük WebP, base64 (öneksiz), <=200 bayt; sığmazsa boş.
 * Dosya adı içerik sürümü taşır (`960w-<8 hex>.avif`): "Değiştir" aynı kimlikte yeni ad üretir, kalıcı önbellek güvenli.
 */

export const VARIANT_WIDTHS = [480, 960, 1600] as const;
export const VARIANT_FORMATS: readonly VariantFormat[] = ["avif", "webp"];

export type ProcessedImage = { w: number; h: number; variants: Array<MediaVariant & { data: Buffer }>; lqip: string; bytes: number };

const LQIP_MAX = 200;

export class ImageProcessError extends Error {}

/** EXIF yönü 5-8 ise görsel 90° döner: genişlik/yükseklik yer değiştirir. */
function orientedSize(meta: Metadata): { w: number; h: number } {
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  return (meta.orientation ?? 1) >= 5 ? { w: h, h: w } : { w, h };
}

async function makeLqip(input: Buffer): Promise<string> {
  for (const width of [16, 12, 8]) {
    const buf = await sharp(input, { limitInputPixels: SITE_MEDIA_LIMITS.maxPixels }).rotate().resize({ width }).webp({ quality: 20, effort: 6 }).toBuffer();
    const b64 = buf.toString("base64");
    if (b64.length <= LQIP_MAX) return b64;
  }
  return "";
}

export async function processSiteImage(input: Buffer, expected: SiteMediaType, opts: { tag?: string } = {}): Promise<ProcessedImage> {
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: SITE_MEDIA_LIMITS.maxPixels, failOn: "error" }).metadata();
  } catch {
    throw new ImageProcessError("Görsel çözülemedi; dosya bozuk ya da çok büyük (en çok 50 megapiksel).");
  }
  // Bayt imzası ile çözücünün gördüğü biçim aynı olmalı (heif = avif kabı).
  const fmt = meta.format === "heif" ? (meta.compression === "av1" ? "avif" : "heic") : meta.format;
  if (fmt !== expected) throw new ImageProcessError("Dosya içeriği bildirilen görsel türüyle uyuşmuyor.");
  if ((meta.pages ?? 1) > 1) throw new ImageProcessError("Hareketli görsel kabul edilmez; durağan bir görsel yükleyin.");
  const { w, h } = orientedSize(meta);
  if (!w || !h) throw new ImageProcessError("Görsel ölçüleri okunamadı.");
  if (w < SITE_MEDIA_LIMITS.minSide || h < SITE_MEDIA_LIMITS.minSide) throw new ImageProcessError(`Görsel en az ${SITE_MEDIA_LIMITS.minSide}x${SITE_MEDIA_LIMITS.minSide} piksel olmalı.`);

  const tag = opts.tag && /^[a-f0-9]{8}$/.test(opts.tag) ? opts.tag : randomBytes(4).toString("hex");
  const widths = [...new Set(VARIANT_WIDTHS.map((t) => Math.min(t, w)))];
  const variants: ProcessedImage["variants"] = [];
  try {
    for (const width of widths) {
      for (const format of VARIANT_FORMATS) {
        const pipe = sharp(input, { limitInputPixels: SITE_MEDIA_LIMITS.maxPixels }).rotate().resize({ width, withoutEnlargement: true });
        const out = await (format === "avif" ? pipe.avif({ quality: 55, effort: 4 }) : pipe.webp({ quality: 76, effort: 4 })).toBuffer({ resolveWithObject: true });
        variants.push({ file: `${width}w-${tag}.${format}`, w: out.info.width, h: out.info.height, format, bytes: out.data.length, data: out.data });
      }
    }
  } catch {
    throw new ImageProcessError("Görsel işlenemedi; başka bir dosya deneyin.");
  }
  const lqip = await makeLqip(input).catch(() => "");
  return { w, h, variants, lqip, bytes: variants.reduce((s, v) => s + v.bytes, 0) };
}
