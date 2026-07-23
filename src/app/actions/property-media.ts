"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";

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

  // İlk görselse kapak yap
  const { count } = await supabase
    .from("property_media")
    .select("id", { count: "exact", head: true })
    .eq("property_id", propertyId);

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
      is_cover: (count ?? 0) === 0,
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
