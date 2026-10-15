"use client";

/**
 * TARAYICI: paylaşılacak fotoğrafları `File[]`e çevirir (MP7). Yalnız tıklamada dinamik import edilir
 * (panel ilk yük paketine girmez). Kaynak `/api/property-media/<id>` public ucudur: yalnız yayındaki ilanın
 * filigranlı, belge olmayan görseli servis edilir. Büyük görsel 2048 px kenara küçültülür; toplam ~15 MB tavanı.
 */
import { SHARE_DOWNSCALE_BYTES, SHARE_MAX_EDGE, SHARE_MAX_TOTAL_BYTES, shareFileExt } from "@/lib/listing-share";

async function downscale(blob: Blob): Promise<Blob> {
  if (blob.size <= SHARE_DOWNSCALE_BYTES || typeof createImageBitmap !== "function") return blob;
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, SHARE_MAX_EDGE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return blob;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return out && out.size < blob.size ? out : blob;
  } catch {
    return blob;
  }
}

export async function prepareListingFiles(ids: readonly string[], baseName: string): Promise<File[]> {
  const safeBase = (baseName || "ilan").replace(/[^\p{L}\p{N}-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "ilan";
  const blobs = await Promise.all(
    ids.map(async (id) => {
      try {
        const res = await fetch(`/api/property-media/${encodeURIComponent(id)}`, { credentials: "same-origin" });
        if (!res.ok) return null;
        const blob = await res.blob();
        if (!/^image\//i.test(blob.type)) return null;
        return await downscale(blob);
      } catch {
        return null;
      }
    }),
  );
  const files: File[] = [];
  let total = 0;
  for (const blob of blobs) {
    if (!blob) continue;
    if (total + blob.size > SHARE_MAX_TOTAL_BYTES) break;
    total += blob.size;
    const type = blob.type || "image/jpeg";
    files.push(new File([blob], `${safeBase}-${files.length + 1}.${shareFileExt(type)}`, { type }));
  }
  return files;
}
