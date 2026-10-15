"use client";

import { finalizePropertyMediaUpload, preparePropertyMediaUpload } from "@/app/actions/property-media";
import { uploadToDirectFileTarget } from "@/lib/direct-file-upload-client";
import { isNetworkFailure } from "@/lib/field-capture/outbox";
import type { PhotoUploader, UploadOutcome } from "@/lib/field-capture/photo-queue";
import type { WatermarkSettings } from "@/lib/watermark";

/**
 * Sahada sıraya alınan fotoğrafı portföye yükler: portföy detayındaki yükleyiciyle AYNI yol (imzalı doğrudan yükleme:
 * hazırla → depoya yükle → kesinleştir; kapak, sıra, denetim kaydı sunucuda). Filigran YÜKLEME ANINDA basılır (çekim
 * anında logo çevrimdışı indirilemeyebilir); filigran tuvali yalnız gerektiğinde dinamik yüklenir.
 */
export function createFieldPhotoUploader(brand: { watermark: WatermarkSettings; officeName: string; logoUrl: string | null }): PhotoUploader {
  let logo: Promise<HTMLImageElement | null> | null = null;
  const offline = (): UploadOutcome => ({ kind: "offline", error: "Bağlantı yok; bağlantı gelince yüklenecek." });

  return async (photo) => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return offline();
    try {
      let file = new File([photo.blob], photo.name, { type: photo.blob.type });
      let stamped = false;
      if (brand.watermark.enabled) {
        const wm = await import("@/lib/watermark-canvas");
        if (brand.watermark.mode !== "text") logo ??= wm.loadWatermarkLogo(brand.logoUrl);
        const res = await wm.applyWatermarkToFile(file, brand.watermark, {
          logo: brand.watermark.mode === "text" ? null : await logo,
          text: (brand.watermark.text || brand.officeName || "").trim(),
        });
        file = res.file;
        stamped = res.applied;
      }
      const prepared = await preparePropertyMediaUpload({
        propertyId: photo.propertyId,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        hasWatermark: stamped,
        isDocument: false,
      });
      if (!prepared.ok) return { kind: "error", error: prepared.error };
      const uploaded = await uploadToDirectFileTarget(prepared.upload, file);
      if (!uploaded.ok) return navigator.onLine === false ? offline() : { kind: "error", error: uploaded.error };
      const dims = photo.width > 0 && photo.height > 0 ? { width: photo.width, height: photo.height } : null;
      const finalized = await finalizePropertyMediaUpload(photo.propertyId, prepared.upload.sessionId, false, dims, null);
      if (!finalized.ok) return { kind: "error", error: finalized.error };
      return { kind: "ok" };
    } catch (e) {
      return isNetworkFailure(e) ? offline() : { kind: "error", error: "Yükleme başarısız; tekrar denenecek." };
    }
  };
}
