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
import { actionErrorMessage } from "@/lib/action-errors";
import { orIlike, safeLike } from "@/lib/pgrst";

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

// ---------------------------------------------------------------------------
// Muhasebe > Belgeler (FN5): defter ekleri (finance_attachments, FN1 RPC'leri).
// Yükleme `/api/app/finans/belge` ucundadır (ikili gövde action'dan geçmez); burada yalnız bağlama, önizleme
// bağlantısı ve bağlanacak kayıt araması var. Yazma yalnız RPC; okuma RLS ile kendi ofisi.
// ---------------------------------------------------------------------------

const LEDGER_NOT_READY = "Belgeler henüz etkin değil (veritabanı güncellemesi bekleniyor).";

function isMissingFinanceSchema(error: { code?: string } | null | undefined): boolean {
  return error?.code === "PGRST202" || error?.code === "42883" || error?.code === "42P01" || error?.code === "PGRST205";
}

async function attachmentWriteGate() {
  const edit = await requirePermission("expenses", "edit");
  return edit.ok ? edit : requirePermission("expenses", "create");
}

/** Fiş kutusundaki eki bir harekete ya da açık kaleme bağlar (ikisi birden değil). */
export async function linkFinanceAttachment(input: {
  id: string;
  entryId?: string | null;
  openItemId?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await attachmentWriteGate();
  if (!gate.ok) return { ok: false, error: gate.error };
  const id = String(input?.id ?? "").trim();
  const entryId = input?.entryId ? String(input.entryId).trim() : null;
  const openItemId = input?.openItemId ? String(input.openItemId).trim() : null;
  if (!UUID_RE.test(id)) return { ok: false, error: "Belge bulunamadı." };
  if ((entryId ? 1 : 0) + (openItemId ? 1 : 0) !== 1) return { ok: false, error: "Bağlanacak bir hareket ya da açık kalem seçin." };
  if ((entryId && !UUID_RE.test(entryId)) || (openItemId && !UUID_RE.test(openItemId))) return { ok: false, error: "Bağlanacak kayıt bulunamadı." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_attachment_link", { p_id: id, p_entry_id: entryId, p_open_item_id: openItemId });
  if (error) {
    if (isMissingFinanceSchema(error)) return { ok: false, error: LEDGER_NOT_READY };
    if ((error.message ?? "").includes("DONEM_KILITLI")) return { ok: false, error: "Bu ay kapatılmış (dönem kilidi); kilitli aydaki kayda belge bağlanamaz." };
    return { ok: false, error: actionErrorMessage(error, "Belge bağlanamadı") };
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "finance.attachment_link",
    entityType: "finance_attachment",
    entityId: id,
    newValue: { entry_id: entryId, open_item_id: openItemId },
  });
  revalidatePath("/app/giderler");
  return { ok: true };
}

/** `{tenant}/ledger/{uuid}-{ad}`: başka ofisin yolu, `..` ve ters bölü reddedilir. */
function isLedgerObjectPath(path: unknown, tenantId: string): boolean {
  if (typeof path !== "string") return false;
  const prefix = `${tenantId}/ledger/`;
  if (!path.startsWith(prefix) || path.includes("..") || path.includes("\\")) return false;
  return /^[0-9a-f-]{36}-[A-Za-z0-9._-]{1,120}$/i.test(path.slice(prefix.length));
}

export type AttachmentPreview ={ ok: true; url: string; type: string; name: string } | { ok: false; error: string };

/** Geçici (2 dk) önizleme bağlantısı. Yol yalnız kendi ofisinin `{tenant}/ledger/` önekindeyse imzalanır. */
export async function financeAttachmentPreview(idValue: string): Promise<AttachmentPreview> {
  const gate = await requirePermission("expenses", "view");
  if (!gate.ok) return { ok: false, error: gate.error };
  const id = String(idValue ?? "").trim();
  if (!UUID_RE.test(id)) return { ok: false, error: "Belge bulunamadı." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("finance_attachments")
    .select("storage_path, file_type, file_name")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (error) return { ok: false, error: isMissingFinanceSchema(error) ? LEDGER_NOT_READY : actionErrorMessage(error, "Belge açılamadı") };
  const row = data as { storage_path: string; file_type: string | null; file_name: string | null } | null;
  if (!row || !isLedgerObjectPath(row.storage_path, gate.tenantId)) return { ok: false, error: "Belge bulunamadı." };
  const signed = await supabase.storage.from("expense-receipts").createSignedUrl(row.storage_path, 120);
  if (signed.error || !signed.data?.signedUrl) return { ok: false, error: "Önizleme bağlantısı oluşturulamadı. Biraz sonra yeniden deneyin." };
  return { ok: true, url: signed.data.signedUrl, type: row.file_type ?? "", name: row.file_name ?? "Belge" };
}

export type LinkTarget = {
  kind: "entry" | "open_item";
  id: string;
  title: string;
  amount: number;
  direction: string;
  date: string | null;
  party: string | null;
};

/** Bağlama penceresi için son hareketler ve açık kalemler (arama metniyle). */
export async function searchFinanceLinkTargets(qValue: string): Promise<{ ok: true; items: LinkTarget[] } | { ok: false; error: string }> {
  const gate = await requirePermission("expenses", "view");
  if (!gate.ok) return { ok: false, error: gate.error };
  const q = String(qValue ?? "").trim().slice(0, 60);
  const supabase = await createClient();
  let entries = supabase
    .from("finance_ledger_v")
    .select("id, title, amount, direction, entry_date, counterparty")
    .eq("tenant_id", gate.tenantId)
    .eq("origin", "entry")
    .is("voided_at", null)
    .order("entry_date", { ascending: false })
    .limit(12);
  let items = supabase
    .from("finance_open_items")
    .select("id, title, amount, direction, due_date")
    .eq("tenant_id", gate.tenantId)
    .in("status", ["open", "partial"])
    .order("due_date", { ascending: true })
    .limit(8);
  if (q) {
    entries = entries.or(orIlike(["title", "counterparty"], q));
    items = items.ilike("title", safeLike(q));
  }
  const [e, o] = await Promise.all([entries, items]);
  if (e.error && o.error) {
    return { ok: false, error: isMissingFinanceSchema(e.error) ? LEDGER_NOT_READY : actionErrorMessage(e.error, "Kayıtlar okunamadı") };
  }
  const out: LinkTarget[] = [];
  for (const r of (e.data ?? []) as Array<{ id: string; title: string | null; amount: number | string; direction: string; entry_date: string | null; counterparty: string | null }>) {
    out.push({ kind: "entry", id: r.id, title: r.title || "Hareket", amount: Number(r.amount) || 0, direction: r.direction, date: r.entry_date, party: r.counterparty });
  }
  for (const r of (o.data ?? []) as Array<{ id: string; title: string | null; amount: number | string; direction: string; due_date: string | null }>) {
    out.push({ kind: "open_item", id: r.id, title: r.title || "Açık kalem", amount: Number(r.amount) || 0, direction: r.direction, date: r.due_date, party: null });
  }
  return { ok: true, items: out };
}
