import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Gider fişi DOSYASI okuyucusu (20261007000700 `expense_receipt_files`). Çağıranın oturumlu (RLS'li) istemcisiyle,
 * AÇIK tenant_id filtreli. Tablo yoksa (migration uygulanmadı) `available: false` — arayüz yükleme düğmesini gizler,
 * eski https fiş bağlantısı (`expenses.receipt_url`) aynen çalışır. İstemci güvenli: yalnız TİP içe aktarır
 * (sabitler `EXPENSE_RECEIPT_ACCEPT`, `expenseReceiptHref` gider formu tarafından da kullanılır).
 */
export type ExpenseReceiptFile = { id: string; expenseId: string; fileName: string; fileType: string; fileSize: number };

export const EXPENSE_RECEIPT_ACCEPT = ".jpg,.jpeg,.png,.webp,.pdf";

/** İndirme/önizleme ucu (tek kaynak). */
export function expenseReceiptHref(fileId: string, mode: "download" | "preview" = "download"): string {
  return `/api/expense-receipts/${fileId}/download${mode === "preview" ? "?onizle=1" : ""}`;
}

export function isMissingExpenseReceiptSchema(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /expense_receipt_files.*(does not exist|schema cache)/i.test(String(error.message ?? ""))
  );
}

const CHUNK = 150;

export async function loadExpenseReceipts(
  db: SupabaseClient,
  tenantId: string,
  expenseIds: readonly string[],
): Promise<{ available: boolean; byExpense: Map<string, ExpenseReceiptFile> }> {
  const byExpense = new Map<string, ExpenseReceiptFile>();
  const ids = [...new Set(expenseIds)].filter(Boolean);
  if (ids.length === 0) {
    // Boş listede de şema durumunu öğren (yükleme düğmesi bunu ister).
    const { error } = await db.from("expense_receipt_files").select("id").eq("tenant_id", tenantId).limit(1);
    if (error && !isMissingExpenseReceiptSchema(error)) console.error("loadExpenseReceipts probe", error.code);
    return { available: !error, byExpense };
  }
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await db
      .from("expense_receipt_files")
      .select("id, expense_id, file_name, file_type, file_size")
      .eq("tenant_id", tenantId)
      .in("expense_id", ids.slice(i, i + CHUNK));
    if (error) {
      if (!isMissingExpenseReceiptSchema(error)) console.error("loadExpenseReceipts", error.code);
      return { available: false, byExpense: new Map() };
    }
    for (const r of data ?? []) {
      byExpense.set(String(r.expense_id), {
        id: String(r.id),
        expenseId: String(r.expense_id),
        fileName: String(r.file_name ?? "fis"),
        fileType: String(r.file_type ?? ""),
        fileSize: Number(r.file_size ?? 0),
      });
    }
  }
  return { available: true, byExpense };
}
