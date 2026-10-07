"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission, type PermissionGate } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import {
  finalizeDirectFileUpload,
  prepareDirectFileUpload,
} from "@/lib/direct-file-upload-server";
import type {
  DirectFileUploadFinalizeResult,
  DirectFileUploadPrepareResult,
} from "@/lib/direct-file-uploads";
import { isMissingExpenseReceiptSchema } from "@/lib/expense-receipts";

/**
 * Gider fişi DOSYASI (20261007000700): mevcut güvenli doğrudan yükleme hattı (imzalı tek nesne jetonu → bayt imzası
 * doğrulaması → tek transaction meta kaydı). Bayt bu action'lardan geçmez. Yetki: giderler:düzenle; yalnız oluşturma
 * yetkisi olan kullanıcı KENDİ oluşturduğu gidere fiş ekleyebilir (yeni gider formu akışı). Silme: giderler:düzenle
 * (RLS ile de aynı kural).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOT_READY = "Fiş dosyası yükleme henüz etkin değil (veritabanı güncellemesi bekleniyor). Fiş bağlantısı alanını kullanabilirsiniz.";

type UploadGate = Extract<PermissionGate, { ok: true }>;

async function expenseUploadGate(expenseId: string): Promise<{ ok: true; gate: UploadGate } | { ok: false; error: string }> {
  if (!UUID_RE.test(expenseId)) return { ok: false, error: "Gider kaydı bulunamadı." };
  const edit = await requirePermission("expenses", "edit");
  const gate = edit.ok ? edit : await requirePermission("expenses", "create");
  if (!gate.ok) return { ok: false, error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .select("id, created_by")
    .eq("id", expenseId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (error) {
    console.error("expense receipt ownership", { code: error.code });
    return { ok: false, error: "Gider kaydı şu an okunamıyor; sayfayı yenileyip yeniden deneyin." };
  }
  if (!data) return { ok: false, error: "Gider kaydı bulunamadı." };
  if (!edit.ok && data.created_by !== gate.userId) {
    return { ok: false, error: "Bu gidere fiş eklemek için düzenleme yetkisi gerekir." };
  }
  return { ok: true, gate };
}

export type PrepareExpenseReceiptInput = {
  expenseId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
};

/** Tek nesnelik özel depolama yazma jetonu üretir (bayt sunucudan geçmez). */
export async function prepareExpenseReceiptUpload(
  input: PrepareExpenseReceiptInput,
): Promise<DirectFileUploadPrepareResult> {
  const expenseId = String(input?.expenseId ?? "").trim();
  const access = await expenseUploadGate(expenseId);
  if (!access.ok) return { error: access.error };
  const { gate } = access;
  const result = await prepareDirectFileUpload(
    { kind: "expense_receipt", tenantId: gate.tenantId, parentId: expenseId, userId: gate.userId },
    { parentId: expenseId, fileName: input.fileName, fileSize: input.fileSize, fileType: input.fileType },
  );
  if (!result.ok && /oturumu oluşturulamadı/.test(result.error)) return { error: NOT_READY };
  return result;
}

/** Saklanan nesne bayt doğrulamasından geçince meta kaydı (eski fiş yerine) yazılır. */
export async function finalizeExpenseReceiptUpload(
  expenseIdValue: string,
  sessionIdValue: string,
): Promise<DirectFileUploadFinalizeResult> {
  const expenseId = String(expenseIdValue ?? "").trim();
  const sessionId = String(sessionIdValue ?? "").trim();
  if (!UUID_RE.test(sessionId)) return { error: "Yükleme oturumu geçersiz." };
  const access = await expenseUploadGate(expenseId);
  if (!access.ok) return { error: access.error };
  const { gate } = access;
  const result = await finalizeDirectFileUpload(
    { kind: "expense_receipt", tenantId: gate.tenantId, parentId: expenseId, userId: gate.userId },
    sessionId,
  );
  if (!result.ok) return result;
  if (result.created) {
    await logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "expense.receipt_upload",
      entityType: "expense",
      entityId: expenseId,
      newValue: { file_id: result.id, upload_mode: "signed_direct" },
    });
  }
  revalidatePath("/app/giderler");
  return result;
}

/** Fiş dosyasını kaldırır; nesne silme kuyruğuna aynı transaction'da yazılır (tetikleyici). */
export async function deleteExpenseReceipt(expenseIdValue: string): Promise<{ ok?: boolean; error?: string }> {
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { error: gate.error };
  const expenseId = String(expenseIdValue ?? "").trim();
  if (!UUID_RE.test(expenseId)) return { error: "Gider kaydı bulunamadı." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expense_receipt_files")
    .delete()
    .eq("tenant_id", gate.tenantId)
    .eq("expense_id", expenseId)
    .select("id, file_name");
  if (error) {
    if (isMissingExpenseReceiptSchema(error)) return { error: NOT_READY };
    console.error("deleteExpenseReceipt", { code: error.code });
    return { error: "Fiş dosyası şu an kaldırılamadı; sayfayı yenileyip yeniden deneyin." };
  }
  if (!data || data.length === 0) return { error: "Fiş dosyası bulunamadı." };
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "expense.receipt_delete",
    entityType: "expense",
    entityId: expenseId,
    oldValue: { file_name: data[0]?.file_name ?? null },
  });
  revalidatePath("/app/giderler");
  return { ok: true };
}
