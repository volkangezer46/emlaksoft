"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSafeTenantObjectPath } from "@/lib/file-validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { extractPropertyDocFields, type PropertyDocFields } from "@/lib/ai/document-ocr";
import {
  finalizeDirectFileUpload,
  prepareDirectFileUpload,
} from "@/lib/direct-file-upload-server";
import type {
  DirectFileUploadFinalizeResult,
  DirectFileUploadPrepareResult,
} from "@/lib/direct-file-uploads";

export type { PropertyDocFields } from "@/lib/ai/document-ocr";

export type MediaResult = { error?: string; ok?: boolean; id?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PreparePropertyMediaUploadInput = {
  propertyId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  hasWatermark?: boolean;
};

async function propertyBelongsToTenant(propertyId: string, tenantId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) console.error("property direct upload ownership", { code: error.code });
  return !error && Boolean(data);
}

/** Creates a private one-object Storage write token; no image body enters Next. */
export async function preparePropertyMediaUpload(
  input: PreparePropertyMediaUploadInput,
): Promise<DirectFileUploadPrepareResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };

  const propertyId = String(input?.propertyId ?? "").trim();
  if (!UUID_RE.test(propertyId)) return { error: "Geçerli bir portföy seçin." };
  if (!(await propertyBelongsToTenant(propertyId, gate.tenantId))) {
    return { error: "Portföy bu ofise ait değil." };
  }

  return prepareDirectFileUpload(
    {
      kind: "property_media",
      tenantId: gate.tenantId,
      parentId: propertyId,
      userId: gate.userId,
    },
    {
      parentId: propertyId,
      fileName: input.fileName,
      fileSize: input.fileSize,
      fileType: input.fileType,
      hasWatermark: input.hasWatermark === true,
    },
  );
}

/** Verifies stored bytes and atomically creates gallery metadata. */
export async function finalizePropertyMediaUpload(
  propertyIdValue: string,
  sessionIdValue: string,
): Promise<DirectFileUploadFinalizeResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };
  const propertyId = String(propertyIdValue ?? "").trim();
  const sessionId = String(sessionIdValue ?? "").trim();
  if (!UUID_RE.test(propertyId) || !UUID_RE.test(sessionId)) {
    return { error: "Yükleme oturumu geçersiz." };
  }
  if (!(await propertyBelongsToTenant(propertyId, gate.tenantId))) {
    return { error: "Portföy bu ofise ait değil." };
  }

  const result = await finalizeDirectFileUpload(
    {
      kind: "property_media",
      tenantId: gate.tenantId,
      parentId: propertyId,
      userId: gate.userId,
    },
    sessionId,
  );
  if (!result.ok) return result;

  if (result.created) {
    await logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "property_media.upload",
      entityType: "property",
      entityId: propertyId,
      newValue: { media_id: result.id, upload_mode: "signed_direct" },
    });
  }
  revalidatePath(`/app/portfoyler/${propertyId}`);
  return result;
}

export async function addPropertyMediaUrl(_prev: MediaResult, formData: FormData): Promise<MediaResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };

  const propertyId = String(formData.get("property_id") ?? "").trim();
  const kind = String(formData.get("kind") ?? "video").trim();
  const url = String(formData.get("external_url") ?? "").trim();
  if (!propertyId) return { error: "Portföy bulunamadı." };
  if (!["video", "tour"].includes(kind)) return { error: "Geçersiz medya türü." };
  if (!/^https?:\/\//i.test(url)) return { error: "Geçerli bir URL girin (https://...)." };

  const supabase = await createClient();
  const { data: prop } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!prop) return { error: "Portföy bu ofise ait değil." };

  const { count } = await supabase
    .from("property_media")
    .select("id", { count: "exact", head: true })
    .eq("property_id", propertyId);

  const { data, error } = await supabase
    .from("property_media")
    .insert({
      tenant_id: gate.tenantId,
      property_id: propertyId,
      kind,
      external_url: url,
      sort_order: count ?? 0,
      uploaded_by: gate.userId,
    })
    .select("id")
    .single();

  if (error) {
    console.error("addPropertyMediaUrl", error);
    return { error: "Bağlantı eklenemedi." };
  }

  revalidatePath(`/app/portfoyler/${propertyId}`);
  return { ok: true, id: data.id };
}

export async function deletePropertyMedia(formData: FormData): Promise<void> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const supabase = await createClient();
  const { data: media } = await supabase
    .from("property_media")
    .select("id, property_id, storage_path")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!media) return;

  if (
    media.storage_path &&
    !isSafeTenantObjectPath(media.storage_path, gate.tenantId, media.property_id)
  ) {
    console.error("deletePropertyMedia unsafe storage path", { id });
    return;
  }
  // DB metadata removal and outbox insertion are one trigger-backed transaction.
  const { error } = await supabase
    .from("property_media")
    .delete()
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("deletePropertyMedia", error);
    return;
  }
  revalidatePath(`/app/portfoyler/${media.property_id}`);
}

export async function setCoverPropertyMedia(formData: FormData): Promise<void> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return;
  const id = String(formData.get("id") ?? "").trim();
  const propertyId = String(formData.get("property_id") ?? "").trim();
  if (!id || !propertyId) return;

  const supabase = await createClient();
  await supabase.from("property_media").update({ is_cover: false }).eq("property_id", propertyId).eq("tenant_id", gate.tenantId);
  await supabase.from("property_media").update({ is_cover: true }).eq("id", id).eq("tenant_id", gate.tenantId);
  revalidatePath(`/app/portfoyler/${propertyId}`);
}

// ---------------------------------------------------------------------------
// Toplu işlemler: sürükle-bırak sıralama + çoklu silme
// ---------------------------------------------------------------------------

/** Gelen id listesini tenant'a ait, bu portföye bağlı ve tekil id'lere indirger. */
async function ownedMediaIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  propertyId: string,
  ids: string[],
): Promise<string[]> {
  const clean = Array.from(new Set(ids.map((i) => String(i ?? "").trim()).filter(Boolean))).slice(0, 500);
  if (clean.length === 0) return [];
  const { data } = await supabase
    .from("property_media")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("property_id", propertyId)
    .in("id", clean);
  const owned = new Set((data ?? []).map((r) => r.id as string));
  // Sıra korunmalı — gelen dizinin sırası yeni sort_order'dır
  return clean.filter((id) => owned.has(id));
}

/**
 * Galeri sırasını (sürükle-bırak sonucu) toplu günceller.
 * `orderedIds` yeni sıradır; listede olmayan medya (video/tur bağlantıları)
 * dokunulmadan kalır. Kapak seçimi bu işlemden etkilenmez.
 */
export async function reorderPropertyMedia(
  propertyId: string,
  orderedIds: string[],
): Promise<MediaResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };

  const pid = String(propertyId ?? "").trim();
  if (!pid) return { error: "Portföy bulunamadı." };

  const supabase = await createClient();
  const ids = await ownedMediaIds(supabase, gate.tenantId, pid, orderedIds ?? []);
  if (ids.length === 0) return { error: "Sıralanacak görsel bulunamadı." };

  // Supabase JS'te tek sorguda "case when" yok; kayıt sayısı (galeri) küçük
  // olduğundan paralel update yeterli — hepsi aynı tenant/portföy filtresiyle.
  const results = await Promise.all(
    ids.map((id, index) =>
      supabase
        .from("property_media")
        .update({ sort_order: index })
        .eq("id", id)
        .eq("tenant_id", gate.tenantId)
        .eq("property_id", pid),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    console.error("reorderPropertyMedia", failed.error);
    return { error: "Sıralama kaydedilemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property_media.reorder",
    entityType: "property",
    entityId: pid,
    newValue: { count: ids.length },
  });

  revalidatePath(`/app/portfoyler/${pid}`);
  return { ok: true };
}

/**
 * Seçili görsellerin metadata kayıtlarını ve storage outbox işlerini atomik siler.
 * Silinenler arasında kapak varsa, kalan ilk görsel otomatik kapak yapılır —
 * portföy asla kapaksız kalmaz.
 */
export async function bulkDeletePropertyMedia(
  propertyId: string,
  ids: string[],
): Promise<MediaResult & { deleted?: number }> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };

  const pid = String(propertyId ?? "").trim();
  if (!pid) return { error: "Portföy bulunamadı." };

  const supabase = await createClient();
  const owned = await ownedMediaIds(supabase, gate.tenantId, pid, ids ?? []);
  if (owned.length === 0) return { error: "Silinecek görsel seçilmedi." };

  const { data: rows } = await supabase
    .from("property_media")
    .select("id, storage_path, is_cover")
    .eq("tenant_id", gate.tenantId)
    .in("id", owned);

  const paths = (rows ?? []).map((r) => r.storage_path).filter(Boolean) as string[];
  if (paths.some((path) => !isSafeTenantObjectPath(path, gate.tenantId, pid))) {
    console.error("bulkDeletePropertyMedia unsafe storage path", { propertyId: pid });
    return { error: "Medya yolu güvenlik doğrulamasından geçemedi." };
  }
  // Each deleted row fires the same transactional outbox trigger. The worker
  // performs bounded, retryable and idempotent storage deletion afterwards.
  const { error } = await supabase
    .from("property_media")
    .delete()
    .eq("tenant_id", gate.tenantId)
    .in("id", owned);
  if (error) {
    console.error("bulkDeletePropertyMedia", error);
    return { error: "Görseller silinemedi." };
  }

  // Kapak silindiyse kalan ilk görseli kapak yap
  if ((rows ?? []).some((r) => r.is_cover)) {
    const { data: next } = await supabase
      .from("property_media")
      .select("id")
      .eq("tenant_id", gate.tenantId)
      .eq("property_id", pid)
      .eq("kind", "image")
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (next?.id) {
      await supabase
        .from("property_media")
        .update({ is_cover: true })
        .eq("id", next.id)
        .eq("tenant_id", gate.tenantId);
    }
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property_media.bulk_delete",
    entityType: "property",
    entityId: pid,
    newValue: { count: owned.length },
  });

  revalidatePath(`/app/portfoyler/${pid}`);
  return { ok: true, deleted: owned.length };
}

// ---------------------------------------------------------------------------
// C8: Belge OCR — görsel belgeden (tapu/yetki belgesi) alan çıkarma
// ---------------------------------------------------------------------------

export type DocOcrActionResult = {
  error?: string;
  fields?: PropertyDocFields;
  guven?: "yüksek" | "orta" | "düşük";
  note?: string | null;
};

/**
 * Medya galerisindeki bir görseli AI ile okur ve tapu alanlarını çıkarır.
 *
 * Görsel `/api/property-media/[id]` route'undan YALNIZCA herkese açık
 * portföyler için servis edildiğinden (taslaklar 404 döner), AI'ye URL
 * geçmek güvenilir değil. Bunun yerine dosya burada service role ile
 * storage'dan indirilip base64 olarak gönderilir — route'un erişim kuralı
 * ne olursa olsun çalışır ve görsel dışarıya URL olarak açılmaz.
 */
export async function ocrPropertyMediaDocument(mediaId: string): Promise<DocOcrActionResult> {
  const gate = await requirePermission("properties", "view");
  if (!gate.ok) return { error: gate.error };

  const id = String(mediaId ?? "").trim();
  if (!id) return { error: "Görsel bulunamadı." };

  const supabase = await createClient();
  const { data: media } = await supabase
    .from("property_media")
    .select("id, kind, storage_path, file_type, property_id")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!media) return { error: "Görsel bulunamadı." };
  if (media.kind !== "image" || !media.storage_path) return { error: "Yalnızca yüklenmiş görseller okunabilir." };

  const admin = createAdminClient();
  const { data: blob, error: dlErr } = await admin.storage.from("property-media").download(media.storage_path);
  if (dlErr || !blob) {
    console.error("ocrPropertyMediaDocument download", dlErr);
    return { error: "Görsel indirilemedi." };
  }

  const imageBase64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
  const result = await extractPropertyDocFields({ imageBase64, mimeType: media.file_type });
  if (!result.ok) return { error: result.error };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property_media.ocr",
    entityType: "property",
    entityId: media.property_id,
    newValue: { media_id: media.id, guven: result.extraction.guven },
  });

  return { fields: result.extraction.fields, guven: result.extraction.guven, note: result.extraction.not };
}

export type DocOcrApplyResult = { error?: string; ok?: boolean; applied?: string[]; noted?: string[] };

const s200 = (v: unknown) => {
  const t = String(v ?? "").trim();
  return t ? t.slice(0, 200) : null;
};

/**
 * OCR sonucunu (kullanıcı onayından geçmiş haliyle) portföye uygular.
 *
 * Doğrudan karşılığı olan kolonlar: ada → parcel_block, parsel → parcel_lot,
 * yüzölçümü → features.sqm (features birleştirilir, ezilmez). il/ilçe/mahalle
 * portföyde AD değil geo ID olarak tutulduğundan ve bağımsız bölüm / malik /
 * tapu tarihi için kolon olmadığından, bu alanlar iç notlara
 * ("Tapu bilgileri (AI): ..." bloğu, authorization_notes) EKLENEREK yazılır —
 * mevcut not silinmez. updateProperty çağrılmıyor: o action başlık/fiyat gibi
 * zorunlu form alanları ister ve alan-bazlı kısmi güncellemeye uygun değil.
 */
export async function applyDocFieldsToProperty(
  propertyId: string,
  input: Partial<PropertyDocFields>,
): Promise<DocOcrApplyResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(propertyId ?? "").trim();
  if (!id) return { error: "Portföy bulunamadı." };

  const supabase = await createClient();
  const { data: prop } = await supabase
    .from("properties")
    .select("id, parcel_block, parcel_lot, features, authorization_notes")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!prop) return { error: "Portföy bu ofise ait değil." };

  const ada = s200(input.ada);
  const parsel = s200(input.parsel);
  const sqmRaw = input.yuzolcumu_m2 != null ? Number(String(input.yuzolcumu_m2).replace(",", ".")) : null;
  const sqm = sqmRaw != null && Number.isFinite(sqmRaw) && sqmRaw > 0 ? sqmRaw : null;

  const applied: string[] = [];
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (ada) {
    patch.parcel_block = ada;
    applied.push("Ada");
  }
  if (parsel) {
    patch.parcel_lot = parsel;
    applied.push("Parsel");
  }
  if (sqm != null) {
    const features = { ...((prop.features ?? {}) as Record<string, unknown>), sqm };
    patch.features = features;
    applied.push("Yüzölçümü (m²)");
  }

  // Portföyde kolonu olmayan tapu alanları → iç notlara blok olarak eklenir
  const noteParts: string[] = [];
  const noted: string[] = [];
  const pushNote = (label: string, value: string | null) => {
    if (!value) return;
    noteParts.push(`${label}: ${value}`);
    noted.push(label);
  };
  pushNote("Bağımsız bölüm", s200(input.bagimsiz_bolum));
  pushNote("İl", s200(input.il));
  pushNote("İlçe", s200(input.ilce));
  pushNote("Mahalle", s200(input.mahalle));
  pushNote("Malik", s200(input.malik_ad_soyad));
  pushNote("Tapu tarihi", s200(input.tapu_tarihi));

  if (noteParts.length) {
    const stamp = new Date().toLocaleDateString("tr-TR");
    const block = `Tapu bilgileri (AI, ${stamp}): ${noteParts.join(" · ")}`;
    const existing = String(prop.authorization_notes ?? "").trim();
    patch.authorization_notes = existing ? `${existing}\n${block}` : block;
  }

  if (!applied.length && !noteParts.length) return { error: "Uygulanacak alan yok." };

  const { error } = await supabase
    .from("properties")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("applyDocFieldsToProperty", error);
    return { error: "Portföy güncellenemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.doc_ocr_apply",
    entityType: "property",
    entityId: id,
    newValue: { applied, noted },
  });

  revalidatePath(`/app/portfoyler/${id}`);
  return { ok: true, applied, noted };
}
