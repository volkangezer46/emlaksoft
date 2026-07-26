"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { extractPropertyDocFields, type PropertyDocFields } from "@/lib/ai/document-ocr";

export type { PropertyDocFields } from "@/lib/ai/document-ocr";

export type MediaResult = { error?: string; ok?: boolean; id?: string };

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB
const ALLOWED_IMAGE = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function uploadPropertyMedia(formData: FormData): Promise<MediaResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };

  const propertyId = String(formData.get("property_id") ?? "").trim();
  const file = formData.get("file") as File | null;
  if (!propertyId) return { error: "Portföy bulunamadı." };
  if (!file) return { error: "Dosya seçilmedi." };
  if (file.size > MAX_FILE_SIZE) return { error: "Dosya çok büyük (max 15 MB)." };
  if (!ALLOWED_IMAGE.includes(file.type)) return { error: "Desteklenmeyen görsel tipi." };

  const supabase = await createClient();
  // Portföy tenant'a ait mi?
  const { data: prop } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!prop) return { error: "Portföy bu ofise ait değil." };

  const admin = createAdminClient();
  const ext = file.name.split(".").pop() || "jpg";
  const storagePath = `${gate.tenantId}/${propertyId}/${Date.now()}.${ext}`;

  const { error: upErr } = await admin.storage
    .from("property-media")
    .upload(storagePath, file, { cacheControl: "31536000", upsert: false });
  if (upErr) {
    console.error("uploadPropertyMedia storage", upErr);
    return { error: "Görsel yüklenemedi." };
  }

  // Sıralama için toplam medya sayısı
  const { count } = await supabase
    .from("property_media")
    .select("id", { count: "exact", head: true })
    .eq("property_id", propertyId);

  // İlk GÖRSELSE kapak yap — video/tur bağlantıları sayılmaz; önce video
  // eklenmiş bir portföyde ilk fotoğrafın kapak olması garanti edilir.
  const { count: imageCount } = await supabase
    .from("property_media")
    .select("id", { count: "exact", head: true })
    .eq("property_id", propertyId)
    .eq("kind", "image");

  const { data, error } = await supabase
    .from("property_media")
    .insert({
      tenant_id: gate.tenantId,
      property_id: propertyId,
      kind: "image",
      storage_path: storagePath,
      file_name: file.name,
      file_type: file.type,
      file_size: file.size,
      is_cover: (imageCount ?? 0) === 0,
      sort_order: count ?? 0,
      uploaded_by: gate.userId,
    })
    .select("id")
    .single();

  if (error) {
    await admin.storage.from("property-media").remove([storagePath]);
    console.error("uploadPropertyMedia db", error);
    return { error: "Görsel kaydedilemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property_media.upload",
    entityType: "property",
    entityId: propertyId,
    newValue: { file_name: file.name },
  });

  revalidatePath(`/app/portfoyler/${propertyId}`);
  return { ok: true, id: data.id };
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
  const propertyId = String(formData.get("property_id") ?? "").trim();
  if (!id) return;

  const supabase = await createClient();
  const { data: media } = await supabase
    .from("property_media")
    .select("id, storage_path")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!media) return;

  if (media.storage_path) {
    const admin = createAdminClient();
    await admin.storage.from("property-media").remove([media.storage_path]);
  }
  await supabase.from("property_media").delete().eq("id", id).eq("tenant_id", gate.tenantId);
  revalidatePath(`/app/portfoyler/${propertyId}`);
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
