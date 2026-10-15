"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { finalizeDirectFileUpload, prepareDirectFileUpload } from "@/lib/direct-file-upload-server";
import { DIRECT_FILE_UPLOAD_CONFIG } from "@/lib/direct-file-uploads";
import { fetchImportPhoto, photoUrlProblem } from "@/lib/import-photo-fetch";

/**
 * İçe aktarılan portföylerin fotoğraf bağlantılarını galeriye indirir (PUB-4).
 *
 * İçe aktarma satırı bağlantıları `features.import_photo_urls` (bekleyen liste) olarak yazar; sihirbaz sonuç adımında
 * portföy portföy bu eylemi çağırır. Her çağrı en çok PER_CALL bağlantı işler: SSRF korumalı indirme
 * (`import-photo-fetch.ts`) → normal yükleme hattı (prepare → imzalı yükleme → finalize: bayt doğrulaması, kota, galeri
 * kaydı). İşlenen (başarılı ya da başarısız) bağlantı listeden düşer; liste boşalınca anahtar silinir. Kalanlar sonraki
 * çağrıda (ya da sayfaya dönünce "Bekleyen fotoğraflar") devam eder.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PER_CALL = 4;

export type PhotoImportResult = {
  ok?: boolean;
  error?: string;
  added?: number;
  failed?: number;
  remaining?: number;
  /** Kısa nedenler ("HTTP 404", "Görsel değil" …) — en çok PER_CALL. */
  failures?: string[];
};

export async function importPropertyPhotos(propertyIdValue: string): Promise<PhotoImportResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };
  const propertyId = String(propertyIdValue ?? "").trim();
  if (!UUID_RE.test(propertyId)) return { error: "Geçerli bir portföy seçin." };

  const supabase = await createClient();
  const { data: prop, error } = await supabase
    .from("properties")
    .select("id, features")
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return { error: "Portföy okunamadı; birkaç saniye sonra tekrar deneyin." };
  if (!prop) return { error: "Portföy bu ofise ait değil ya da silinmiş." };

  const features = ((prop.features ?? {}) as Record<string, unknown>) ?? {};
  const pending = Array.isArray(features.import_photo_urls)
    ? (features.import_photo_urls as unknown[]).filter((u): u is string => typeof u === "string")
    : [];
  if (!pending.length) return { ok: true, added: 0, failed: 0, remaining: 0 };

  const batch = pending.slice(0, PER_CALL);
  const context = { kind: "property_media" as const, tenantId: gate.tenantId, parentId: propertyId, userId: gate.userId };
  const maxBytes = DIRECT_FILE_UPLOAD_CONFIG.property_media.maxBytes;
  let added = 0;
  const failures: string[] = [];
  let processed = 0;
  let stopError: string | null = null;

  for (const [i, url] of batch.entries()) {
    const problem = photoUrlProblem(url);
    if (problem) {
      failures.push(problem);
      processed += 1;
      continue;
    }
    const img = await fetchImportPhoto(url, { maxBytes });
    if (!img.ok) {
      failures.push(img.error);
      processed += 1;
      continue;
    }
    const prep = await prepareDirectFileUpload(context, {
      parentId: propertyId,
      fileName: `ice-aktarma-${pending.length - batch.length + i + 1}.${img.ext}`,
      fileSize: img.bytes.length,
      fileType: img.mime,
    });
    if (!prep.ok) {
      // Hız sınırı/oturum hatası: bağlantı listede kalır, sonra yeniden denenir.
      stopError = prep.error;
      break;
    }
    const up = await supabase.storage
      .from(prep.upload.bucket)
      .uploadToSignedUrl(prep.upload.path, prep.upload.token, img.bytes, { contentType: prep.upload.contentType });
    if (up.error) {
      failures.push("Depoya yazma hatası (geçici)");
      processed += 1;
      continue;
    }
    const fin = await finalizeDirectFileUpload(context, prep.upload.sessionId);
    if (!fin.ok) failures.push(fin.error);
    else added += 1;
    processed += 1;
  }

  const rest = pending.slice(processed);
  const nextFeatures: Record<string, unknown> = { ...features };
  if (rest.length) nextFeatures.import_photo_urls = rest;
  else delete nextFeatures.import_photo_urls;
  if (processed > 0) {
    const { error: upErr } = await supabase
      .from("properties")
      .update({ features: nextFeatures })
      .eq("id", propertyId)
      .eq("tenant_id", gate.tenantId);
    if (upErr) console.error("importPropertyPhotos pending update", { code: upErr.code });
  }
  if (added > 0) {
    await logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "property_media.upload",
      entityType: "property",
      entityId: propertyId,
      newValue: { upload_mode: "import_url", added, failed: failures.length },
    });
    revalidatePath(`/app/portfoyler/${propertyId}`);
  }
  if (stopError) return { error: stopError, added, failed: failures.length, remaining: rest.length, failures };
  return { ok: true, added, failed: failures.length, remaining: rest.length, failures };
}

/** Bekleyen fotoğraf indirmesi olan portföyler (sihirbaza dönünce kaldığı yerden devam). */
export async function listPendingPhotoImports(): Promise<{ ids: string[]; urls: number }> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { ids: [], urls: 0 };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("properties")
    .select("id, features")
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .not("features->import_photo_urls", "is", null)
    .limit(500);
  if (error || !data) return { ids: [], urls: 0 };
  let urls = 0;
  const ids: string[] = [];
  for (const row of data as { id: string; features: Record<string, unknown> | null }[]) {
    const list = row.features?.import_photo_urls;
    if (Array.isArray(list) && list.length) {
      ids.push(row.id);
      urls += list.length;
    }
  }
  return { ids, urls };
}
