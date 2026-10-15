"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import {
  finalizeDirectFileUpload,
  prepareDirectFileUpload,
} from "@/lib/direct-file-upload-server";
import type {
  DirectFileUploadFinalizeResult,
  DirectFileUploadPrepareResult,
} from "@/lib/direct-file-uploads";
import { isSafeTenantObjectPath } from "@/lib/file-validation";
import { actionErrorMessage } from "@/lib/action-errors";
import { normalizeDateKey } from "@/lib/documents";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PrepareCustomerFileUploadInput = {
  customerId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  label?: string | null;
};

async function customerBelongsToTenant(customerId: string, tenantId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("id")
    .eq("id", customerId)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) console.error("customer direct upload ownership", { code: error.code });
  return !error && Boolean(data);
}

/** Creates a one-object private Storage write token; no bytes cross the action. */
export async function prepareCustomerFileUpload(
  input: PrepareCustomerFileUploadInput,
): Promise<DirectFileUploadPrepareResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };

  const customerId = String(input?.customerId ?? "").trim();
  if (!UUID_RE.test(customerId)) return { error: "Geçerli bir müşteri seçin." };
  if (!(await customerBelongsToTenant(customerId, gate.tenantId))) {
    return { error: "Müşteri bu ofise ait değil veya artık aktif değil." };
  }

  return prepareDirectFileUpload(
    {
      kind: "customer_file",
      tenantId: gate.tenantId,
      parentId: customerId,
      userId: gate.userId,
    },
    {
      parentId: customerId,
      fileName: input.fileName,
      fileSize: input.fileSize,
      fileType: input.fileType,
      label: input.label,
    },
  );
}

/** Sütun (20261016100200) henüz yoksa geçerlilik tarihi sessizce atlanır; dosya yine kaydedilir. */
function isMissingValidUntilColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42703" || error.code === "PGRST204" || /valid_until/.test(error.message ?? "");
}

/**
 * Opsiyonel geçerlilik tarihi girdisi: boş → null (süresiz), geçersiz → hata.
 * Makul aralık: 2000-01-01 … 2100-12-31 (yazım hatasıyla 20250 gibi değerler girmesin).
 */
function parseValidUntilInput(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return { ok: true, value: null };
  const key = normalizeDateKey(raw);
  if (!key || key < "2000-01-01" || key > "2100-12-31") {
    return { ok: false, error: "Geçerlilik tarihi geçersiz; takvimden gerçek bir tarih seçin." };
  }
  return { ok: true, value: key };
}

/** Finalizes only after the stored object passes bounded byte verification. */
export async function finalizeCustomerFileUpload(
  customerIdValue: string,
  sessionIdValue: string,
  validUntilValue?: string | null,
): Promise<DirectFileUploadFinalizeResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };
  const customerId = String(customerIdValue ?? "").trim();
  const sessionId = String(sessionIdValue ?? "").trim();
  if (!UUID_RE.test(customerId) || !UUID_RE.test(sessionId)) {
    return { error: "Yükleme oturumu geçersiz." };
  }
  const validUntil = parseValidUntilInput(validUntilValue);
  if (!validUntil.ok) return { error: validUntil.error };
  if (!(await customerBelongsToTenant(customerId, gate.tenantId))) {
    return { error: "Müşteri bu ofise ait değil veya artık aktif değil." };
  }

  const result = await finalizeDirectFileUpload(
    {
      kind: "customer_file",
      tenantId: gate.tenantId,
      parentId: customerId,
      userId: gate.userId,
    },
    sessionId,
  );
  if (!result.ok) return result;

  // Geçerlilik tarihi doğrulanmış satıra ayrı yazılır (finalize RPC'si değişmez). Yazılamazsa
  // dosya kaydı geri alınmaz: tarih belge merkezinden sonradan girilebilir.
  if (validUntil.value) {
    const supabase = await createClient();
    const { error } = await supabase
      .from("customer_files")
      .update({ valid_until: validUntil.value })
      .eq("id", result.id)
      .eq("tenant_id", gate.tenantId)
      .eq("customer_id", customerId);
    if (error && !isMissingValidUntilColumn(error)) {
      console.error("finalizeCustomerFileUpload valid_until", { code: error.code });
    }
  }

  if (result.created) {
    await logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "customer_file.upload",
      entityType: "customer",
      entityId: customerId,
      newValue: { file_id: result.id, upload_mode: "signed_direct" },
    });
  }
  revalidatePath(`/app/musteriler/${customerId}`);
  revalidatePath("/app/belgeler");
  return result;
}

/** Var olan müşteri belgesinin geçerlilik tarihini ayarlar ya da kaldırır (boş = süresiz). */
export async function updateCustomerFileValidUntil(
  fileIdValue: string,
  validUntilValue: string | null,
): Promise<{ error?: string; ok?: boolean }> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };
  const fileId = String(fileIdValue ?? "").trim();
  if (!UUID_RE.test(fileId)) return { error: "Dosya bulunamadı." };
  const validUntil = parseValidUntilInput(validUntilValue);
  if (!validUntil.ok) return { error: validUntil.error };

  const supabase = await createClient();
  const { data: file, error } = await supabase
    .from("customer_files")
    .update({ valid_until: validUntil.value })
    .eq("id", fileId)
    .eq("tenant_id", gate.tenantId)
    .select("id, customer_id")
    .maybeSingle();
  if (error) {
    if (isMissingValidUntilColumn(error)) {
      return { error: "Geçerlilik tarihi özelliği henüz etkin değil (kurulum bekliyor)." };
    }
    console.error("updateCustomerFileValidUntil", { code: error.code });
    return { error: actionErrorMessage(error, "Geçerlilik tarihi kaydedilemedi.") };
  }
  if (!file) return { error: "Dosya bulunamadı." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "customer_file.valid_until",
    entityType: "customer",
    entityId: file.customer_id,
    newValue: { file_id: file.id, valid_until: validUntil.value },
  });
  revalidatePath(`/app/musteriler/${file.customer_id}`);
  revalidatePath("/app/belgeler");
  return { ok: true };
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
  if (!isSafeTenantObjectPath(file.storage_path, gate.tenantId, file.customer_id)) {
    console.error("deleteCustomerFile unsafe storage path", { fileId });
    return { error: "Dosya yolu güvenlik doğrulamasından geçemedi." };
  }

  // The AFTER DELETE trigger atomically records the object in the durable
  // outbox. Storage removal happens asynchronously and may be retried safely.
  const { error } = await supabase
    .from("customer_files")
    .delete()
    .eq("id", fileId)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("deleteCustomerFile", error);
    return { error: actionErrorMessage(error, "Dosya silinemedi.") };
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
