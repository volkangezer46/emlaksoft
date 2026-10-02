"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { validateTenantReferences } from "@/lib/tenant-references";
import { isExpenseId, parseExpenseForm } from "@/lib/expense-input";

export type ExpenseResult = { ok?: boolean; error?: string; id?: string };

export async function createExpense(
  _prev: ExpenseResult,
  fd: FormData,
): Promise<ExpenseResult> {
  const gate = await requirePermission("expenses", "create");
  if (!gate.ok) return { error: gate.error };

  const parsed = parseExpenseForm(fd);
  if (!parsed.ok) return { error: parsed.error };
  const { title, amount, category, expenseDate, notes, propertyId } = parsed.value;

  const references = await validateTenantReferences(gate.tenantId, { propertyId });
  if (!references.ok) return { error: references.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .insert({
      tenant_id:    gate.tenantId,
      created_by:   gate.userId,
      title,
      amount,
      category,
      expense_date: expenseDate,
      notes,
      property_id:  propertyId,
    })
    .select("id")
    .single();

  if (error || !data) return { error: "Gider kaydedilemedi." };

  revalidatePath("/app/giderler");
  return { ok: true, id: data.id };
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
  const { title, amount, category, expenseDate, notes, propertyId } = parsed.value;

  const references = await validateTenantReferences(gate.tenantId, { propertyId });
  if (!references.ok) return { error: references.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .update({ title, amount, category, expense_date: expenseDate, notes, property_id: propertyId })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .select("id")
    .maybeSingle();

  if (error) return { error: "Gider güncellenemedi." };
  if (!data) return { error: "Gider kaydı bulunamadı." };

  revalidatePath("/app/giderler");
  return { ok: true, id };
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
    return { error: "Gider silinemedi." };
  }
  if (!data) return { error: "Gider kaydı bulunamadı." };

  revalidatePath("/app/giderler");
  return { ok: true, id: cleanId };
}

export async function listExpenses(
  month?: string,
  range?: { from?: string; to?: string },
) {
  const gate = await requirePermission("expenses", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  let query = supabase
    .from("expenses")
    .select("id, title, amount, category, expense_date, notes, created_at, property:properties(property_code, title)")
    .eq("tenant_id", gate.tenantId)
    .order("expense_date", { ascending: false })
    .limit(200);

  if (month) {
    // Ayın ilk günü (dahil) → sonraki ayın ilk günü (hariç) — geçersiz -31 tarihi yok
    const [y, m] = month.split("-").map(Number);
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    query = query.gte("expense_date", `${month}-01`).lt("expense_date", next);
  }

  // Serbest tarih aralığı — expense_date `date` kolonu, `lte` uç günü kapsar
  if (range?.from) query = query.gte("expense_date", range.from);
  if (range?.to) query = query.lte("expense_date", range.to);

  const { data, error } = await query;
  if (error) {
    console.error("listExpenses", error);
    throw new Error("Gider kayıtları güvenli şekilde yüklenemedi.");
  }
  return data ?? [];
}
