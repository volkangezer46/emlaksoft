import { validateBrandSvg } from "./svg-sanitizer";
import {
  BRAND_MAX_BYTES,
  BRAND_PNG_MAX_SIDE,
  BRAND_PNG_MIN_SIDE,
  BRAND_SLOT_LABELS,
  type BrandAssetType,
  type BrandSlot,
} from "./slots";

export type BrandUploadCheck =
  | { ok: true; type: BrandAssetType; data: string; bytes: number }
  | { ok: false; error: string };

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function hasPngSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && PNG_SIG.every((b, i) => bytes[i] === b);
}

/** PNG IHDR genişlik/yükseklik (ilk parça IHDR olmalı). */
export function readPngSize(bytes: Uint8Array): { w: number; h: number } | null {
  if (!hasPngSignature(bytes) || bytes.length < 33) return null;
  const type = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (type !== "IHDR") return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { w: v.getUint32(16), h: v.getUint32(20) };
}

function svgIsSquare(svg: string): boolean {
  const m = /viewBox\s*=\s*["']\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)\s*["']/i.exec(svg);
  if (!m) return false;
  const w = Number(m[3]);
  const h = Number(m[4]);
  if (!(w > 0) || !(h > 0)) return false;
  return Math.abs(w - h) / Math.max(w, h) <= 0.05;
}

/** Bayt içeriğine göre türü belirler (istemcinin bildirdiği MIME'a güvenilmez) ve slot kurallarını uygular. */
export function checkBrandUpload(slot: BrandSlot, bytes: Uint8Array): BrandUploadCheck {
  if (bytes.length === 0) return { ok: false, error: "Dosya boş." };
  const needSquare = BRAND_SLOT_LABELS[slot].square;

  if (hasPngSignature(bytes)) {
    if (bytes.length > BRAND_MAX_BYTES.png) {
      return { ok: false, error: `PNG en fazla ${BRAND_MAX_BYTES.png / 1024} KB olabilir.` };
    }
    const size = readPngSize(bytes);
    if (!size) return { ok: false, error: "PNG başlığı okunamadı; dosya bozuk." };
    if (size.w < BRAND_PNG_MIN_SIDE || size.h < BRAND_PNG_MIN_SIDE) {
      return { ok: false, error: `PNG en az ${BRAND_PNG_MIN_SIDE}x${BRAND_PNG_MIN_SIDE} piksel olmalı.` };
    }
    if (size.w > BRAND_PNG_MAX_SIDE || size.h > BRAND_PNG_MAX_SIDE) {
      return { ok: false, error: `PNG en fazla ${BRAND_PNG_MAX_SIDE}x${BRAND_PNG_MAX_SIDE} piksel olabilir.` };
    }
    if (needSquare && size.w !== size.h) {
      return { ok: false, error: "Bu alan için kare (en = boy) bir görsel gerekir." };
    }
    return { ok: true, type: "png", data: Buffer.from(bytes).toString("base64"), bytes: bytes.length };
  }

  // PNG imzası yok -> SVG metni olmalı; ikili içerik reddedilir.
  if (bytes.length > BRAND_MAX_BYTES.svg) {
    return { ok: false, error: `SVG en fazla ${BRAND_MAX_BYTES.svg / 1024} KB olabilir.` };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, error: "Yalnız SVG veya PNG yüklenebilir." };
  }
  const res = validateBrandSvg(text, BRAND_MAX_BYTES.svg);
  if (!res.ok) return { ok: false, error: res.error };
  if (needSquare && !svgIsSquare(res.svg)) {
    return { ok: false, error: "Bu alan için kare (en = boy) bir viewBox gerekir." };
  }
  return { ok: true, type: "svg", data: res.svg, bytes: Buffer.byteLength(res.svg, "utf8") };
}
