"use client";

import { createClient } from "@/lib/supabase/client";
import {
  DIRECT_FILE_UPLOAD_CONFIG,
  type DirectFileUploadTarget,
} from "@/lib/direct-file-uploads";

/** Uploads bytes straight to the private bucket with the one-object token. */
export async function uploadToDirectFileTarget(
  target: DirectFileUploadTarget,
  file: File,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!file || file.size <= 0 || file.type.toLowerCase().split(";", 1)[0]?.trim() !== target.contentType) {
    return { ok: false, error: "Dosya bilgileri güvenli yükleme oturumuyla eşleşmiyor." };
  }

  const config = target.bucket === "customer-files"
    ? DIRECT_FILE_UPLOAD_CONFIG.customer_file
    : DIRECT_FILE_UPLOAD_CONFIG.property_media;
  if (file.size > config.maxBytes) {
    return { ok: false, error: "Dosya yükleme sınırını aşıyor." };
  }

  const supabase = createClient();
  const { error } = await supabase.storage
    .from(target.bucket)
    .uploadToSignedUrl(target.path, target.token, file, {
      cacheControl: config.cacheControl,
      contentType: target.contentType,
    });
  if (error) {
    return { ok: false, error: "Dosya özel depolama alanına yüklenemedi." };
  }
  return { ok: true };
}
