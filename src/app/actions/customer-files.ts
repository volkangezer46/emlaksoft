"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";

export type FileUploadResult = { error?: string; ok?: boolean; fileId?: string };

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

export async function uploadCustomerFile(formData: FormData): Promise<FileUploadResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };

  const customerId = String(formData.get("customer_id") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim() || null;
  const file = formData.get("file") as File | null;

  if (!customerId) return { error: "Müşteri ID zorunlu." };
  if (!file) return { error: "Dosya seçilmedi." };
  if (file.size > MAX_FILE_SIZE) return { error: "Dosya çok büyük (max 10 MB)." };
  if (!ALLOWED_TYPES.includes(file.type)) return { error: "Desteklenmeyen dosya tipi." };

  const supabase = await createClient();

  // Dosya Supabase Storage'a yükle
  const ext = file.name.split(".").pop() || "bin";
  const timestamp = Date.now();
  const storagePath = `${gate.tenantId}/${customerId}/${timestamp}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("customer-files")
    .upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (uploadError) {
    console.error("uploadCustomerFile storage", uploadError);
    return { error: "Dosya yüklenemedi." };
  }

  // Metadata kaydet
  const { data, error: dbError } = await supabase
    .from("customer_files")
    .insert({
      tenant_id: gate.tenantId,
      customer_id: customerId,
      file_name: file.name,
      file_size: file.size,
      file_type: file.type,
      storage_path: storagePath,
      label,
      uploaded_by: gate.userId,
    })
    .select("id")
    .single();

  if (dbError) {
    console.error("uploadCustomerFile db", dbError);
    // Temizle storage
    await supabase.storage.from("customer-files").remove([storagePath]);
    return { error: "Dosya kaydedilemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "customer_file.upload",
    entityType: "customer",
    entityId: customerId,
    newValue: { file_name: file.name, label },
  });

  revalidatePath(`/app/musteriler/${customerId}`);
  return { ok: true, fileId: data.id };
}

export async function deleteCustomerFile(fileId: string): Promise<{ error?: string; ok?: boolean }> {
  const gate = await requirePermission("customers", "delete");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { data: file } = await supabase
    .from("customer_files")
    .select("id, tenant_id, customer_id, storage_path, file_name")
    .eq("id", fileId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!file) return { error: "Dosya bulunamadı." };

  await supabase.storage.from("customer-files").remove([file.storage_path]);

  const { error } = await supabase
    .from("customer_files")
    .delete()
    .eq("id", fileId)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("deleteCustomerFile", error);
    return { error: "Dosya silinemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "customer_file.delete",
    entityType: "customer",
    entityId: file.customer_id,
    oldValue: { file_name: file.file_name },
  });

  revalidatePath(`/app/musteriler/${file.customer_id}`);
  return { ok: true };
}
