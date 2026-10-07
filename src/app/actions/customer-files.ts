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

/** Finalizes only after the stored object passes bounded byte verification. */
export async function finalizeCustomerFileUpload(
  customerIdValue: string,
  sessionIdValue: string,
): Promise<DirectFileUploadFinalizeResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };
  const customerId = String(customerIdValue ?? "").trim();
  const sessionId = String(sessionIdValue ?? "").trim();
  if (!UUID_RE.test(customerId) || !UUID_RE.test(sessionId)) {
    return { error: "Yükleme oturumu geçersiz." };
  }
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
  return result;
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
