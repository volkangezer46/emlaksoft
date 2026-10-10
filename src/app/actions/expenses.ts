"use server";

import { revalidatePath } from "next/cache";
import { revalidateTenantData } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { validateTenantReferences } from "@/lib/tenant-references";
import { isExpenseId, parseExpenseForm } from "@/lib/expense-input";
import { logActivity } from "@/lib/activity";
import { getDefinitionsOrDefault } from "@/lib/definitions";
import { actionErrorMessage } from "@/lib/action-errors";
import { parseExpenseFinanceFields } from "@/lib/finance/expense-finance-input";
import { isMissingFinanceSchema } from "@/lib/finance/load";
import { cashCategoryForExpense } from "@/lib/finance/cash/categories";

const FINANCE_MISSING = "Tekrarlayan gider / portal eşlemesi için veritabanı güncellemesi bekleniyor. Bu alanları boş bırakıp kaydedin.";

export type ExpenseResult = { ok?: boolean; error?: string; id?: string; info?: string };

type PropertyRef = { property_code: string | null; title: string | null };

/** listExpenses satırı. recurrence/portal_key şema (20261008000700) yokken gelmez. */
export type ExpenseListRow = {
  id: string;
  title: string;
  amount: number | string;
  category: string;
  expense_date: string;
  notes: string | null;
  receipt_url: string | null;
  property_id: string | null;
  created_at: string;
  property: PropertyRef | PropertyRef[] | null;
  recurrence?: string | null;
  portal_key?: string | null;
};

export async function createExpense(
  _prev: ExpenseResult,
  fd: FormData,
): Promise<ExpenseResult> {
  const gate = await requirePermission("expenses", "create");
  if (!gate.ok) return { error: gate.error };

  const parsed = parseExpenseForm(fd);
  if (!parsed.ok) return { error: parsed.error };
  const { title, amount, category, expenseDate, notes, propertyId, receiptUrl } = parsed.value;

  const fin = parseExpenseFinanceFields(fd);
  if (!fin.ok) return { error: fin.error };

  const references = await validateTenantReferences(gate.tenantId, { propertyId });
  if (!references.ok) return { error: references.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .insert({
      receipt_url:  receiptUrl,
      tenant_id:    gate.tenantId,
      created_by:   gate.userId,
      title,
      amount,
      category,
      expense_date: expenseDate,
      notes,
      property_id:  propertyId,
      // Yeni sütunlar yalnız doluysa yazılır: şema (20261008000700) yokken eski gider akışı aynen çalışır.
      ...(fin.value.recurrence ? { recurrence: fin.value.recurrence } : {}),
      ...(fin.value.portalKey ? { portal_key: fin.value.portalKey } : {}),
    })
    .select("id")
    .single();

  if (error || !data) return { error: isMissingFinanceSchema(error) ? FINANCE_MISSING : actionErrorMessage(error, "Gider kaydedilemedi.") };

  // İsteğe bağlı "Hangi hesaptan çıktı?": seçildiyse aynı gider için ofis hesabına çıkış hareketi (gider kaydı tek gerçek kalır).
  let info: string | undefined;
  const accountId = String(fd.get("account_id") ?? "").trim();
  if (accountId) {
    const { data: moved, error: moveError } = await supabase.rpc("finance_record_entry", {
      p_account_id: accountId,
      p_direction: "out",
      p_amount: amount,
      p_entry_date: expenseDate,
      p_category: cashCategoryForExpense(category),
      p_title: title,
      p_note: notes,
      p_document_url: receiptUrl,
      p_source_type: "manual",
      p_source_id: null,
      p_expense_id: data.id,
    });
    const outcome = (moved as { outcome?: string } | null)?.outcome;
    if (moveError || outcome !== "recorded") {
      info = "Gider kaydedildi ancak seçilen hesaba hareket yazılamadı. Finans > Hareketler'den ekleyebilirsiniz.";
    }
  }

  revalidatePath("/app/giderler");
  if (propertyId) revalidatePath(`/app/portfoyler/${propertyId}`);
  revalidateTenantData(gate.tenantId);
  return { ok: true, id: data.id, info };
}

export async function updateExpense(
  _prev: ExpenseResult,
  fd: FormData,
): Promise<ExpenseResult> {
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(fd.get("id") ?? "").trim();
  if (!isExpenseId(id)) return { error: "Kayıt bulunamadı." };

  const parsed = parseExpenseForm(fd);
  if (!parsed.ok) return { error: parsed.error };
  const { title, amount, category, expenseDate, notes, propertyId, receiptUrl } = parsed.value;

  const fin = parseExpenseFinanceFields(fd);
  if (!fin.ok) return { error: fin.error };

  const references = await validateTenantReferences(gate.tenantId, { propertyId });
  if (!references.ok) return { error: references.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    // Düzenleme formu portföy alanı taşımıyor: alan yoksa mevcut portföy bağı korunur (veri kaybı düzeltmesi).
    .update({
      title,
      amount,
      category,
      expense_date: expenseDate,
      notes,
      ...(fd.has("property_id") ? { property_id: propertyId } : {}),
      ...(fd.has("receipt_url") ? { receipt_url: receiptUrl } : {}),
      ...(fin.value.hasRecurrence ? { recurrence: fin.value.recurrence } : {}),
      ...(fin.value.hasPortal ? { portal_key: fin.value.portalKey } : {}),
    })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .select("id")
    .maybeSingle();

  if (error) return { error: isMissingFinanceSchema(error) ? FINANCE_MISSING : actionErrorMessage(error, "Gider güncellenemedi.") };
  if (!data) return { error: "Gider kaydı bulunamadı." };

  revalidatePath("/app/giderler");
  if (propertyId) revalidatePath(`/app/portfoyler/${propertyId}`);
  revalidateTenantData(gate.tenantId);
  return { ok: true, id };
}

const BULK_EXPENSE_MAX = 200;

function cleanExpenseIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.map((v) => String(v).trim()).filter(isExpenseId))].slice(0, BULK_EXPENSE_MAX);
}

export type BulkExpenseResult = { error?: string; count?: number };

/** Toplu kategori değişimi (gider listesi toplu işlemi). Kategori tanım listesinden olmalı. */
export async function bulkSetExpenseCategory(ids: string[], category: string): Promise<BulkExpenseResult> {
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { error: gate.error };
  const list = cleanExpenseIds(ids);
  if (list.length === 0) return { error: "Gider seçin." };
  const cat = String(category ?? "").trim();
  const defs = await getDefinitionsOrDefault("expense_category");
  if (!defs.some((d) => d.value === cat)) return { error: "Geçerli bir gider kategorisi seçin." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .update({ category: cat })
    .in("id", list)
    .eq("tenant_id", gate.tenantId)
    .select("id");
  if (error) {
    console.error("bulkSetExpenseCategory", error);
    return { error: actionErrorMessage(error, "Kategori güncellenemedi.") };
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "expense.bulk_category",
    entityType: "expense",
    newValue: { category: cat, count: (data ?? []).length },
  });
  revalidatePath("/app/giderler");
  revalidateTenantData(gate.tenantId);
  return { count: (data ?? []).length };
}

/** Toplu silme (kalıcı; onay diyaloğu istemcide). */
export async function bulkDeleteExpenses(ids: string[]): Promise<BulkExpenseResult> {
  const gate = await requirePermission("expenses", "delete");
  if (!gate.ok) return { error: gate.error };
  const list = cleanExpenseIds(ids);
  if (list.length === 0) return { error: "Gider seçin." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .delete()
    .in("id", list)
    .eq("tenant_id", gate.tenantId)
    .select("id");
  if (error) {
    console.error("bulkDeleteExpenses", error);
    return { error: actionErrorMessage(error, "Giderler silinemedi.") };
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "expense.bulk_delete",
    entityType: "expense",
    oldValue: { count: (data ?? []).length },
  });
  revalidatePath("/app/giderler");
  revalidateTenantData(gate.tenantId);
  return { count: (data ?? []).length };
}

export async function deleteExpense(id: string): Promise<ExpenseResult> {
  const gate = await requirePermission("expenses", "delete");
  if (!gate.ok) return { error: gate.error };

  const cleanId = String(id ?? "").trim();
  if (!isExpenseId(cleanId)) return { error: "Kayıt bulunamadı." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .delete()
    .eq("id", cleanId)
    .eq("tenant_id", gate.tenantId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("deleteExpense", error);
    return { error: actionErrorMessage(error, "Gider silinemedi.") };
  }
  if (!data) return { error: "Gider kaydı bulunamadı." };

  revalidatePath("/app/giderler");
  revalidateTenantData(gate.tenantId);
  return { ok: true, id: cleanId };
}

export async function listExpenses(
  month?: string,
  range?: { from?: string; to?: string; propertyId?: string; portalKey?: string },
  limit = 200,
) {
  const gate = await requirePermission("expenses", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const baseColumns = "id, title, amount, category, expense_date, notes, receipt_url, property_id, created_at, property:properties!expenses_property_id_fkey(property_code, title)";
  // recurrence / portal_key sütunları migration 20261008000700 ile gelir; yoksa eski sütunlarla tekrar denenir.
  const build = (columns: string, withPortalFilter: boolean) => {
    let query = supabase
      .from("expenses")
      .select(columns)
      .eq("tenant_id", gate.tenantId)
      .order("expense_date", { ascending: false })
      .limit(Math.min(Math.max(Math.trunc(limit) || 200, 1), 1000));

    if (month) {
      // Ayın ilk günü (dahil) → sonraki ayın ilk günü (hariç) — geçersiz -31 tarihi yok
      const [y, m] = month.split("-").map(Number);
      const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
      query = query.gte("expense_date", `${month}-01`).lt("expense_date", next);
    }

    // Serbest tarih aralığı — expense_date `date` kolonu, `lte` uç günü kapsar
    if (range?.from) query = query.gte("expense_date", range.from);
    if (range?.to) query = query.lte("expense_date", range.to);
    if (range?.propertyId && isExpenseId(range.propertyId)) query = query.eq("property_id", range.propertyId);
    if (withPortalFilter && range?.portalKey) query = query.eq("portal_key", range.portalKey);
    return query;
  };

  let { data, error } = await build(`${baseColumns}, recurrence, portal_key`, true);
  if (error && isMissingFinanceSchema(error)) {
    // Şema henüz yok: portal süzgeci uygulanamaz (boş liste döner), diğer filtreler eski sütunlarla çalışır.
    if (range?.portalKey) return [];
    ({ data, error } = await build(baseColumns, false));
  }
  if (error) {
    console.error("listExpenses", error);
    throw new Error("Gider kayıtları güvenli şekilde yüklenemedi.");
  }
  return (data ?? []) as unknown as ExpenseListRow[];
}
