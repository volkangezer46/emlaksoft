"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";

export type ExpenseResult = { ok?: boolean; error?: string; id?: string };

export async function createExpense(
  _prev: ExpenseResult,
  fd: FormData,
): Promise<ExpenseResult> {
  const gate = await requirePermission("reports", "create");
  if (!gate.ok) return { error: gate.error };

  const title       = String(fd.get("title")       ?? "").trim();
  const amount      = parseFloat(String(fd.get("amount") ?? "0"));
  const category    = String(fd.get("category")    ?? "diger").trim();
  const expenseDate = String(fd.get("expense_date") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const notes       = String(fd.get("notes")       ?? "").trim() || null;
  const propertyId  = String(fd.get("property_id") ?? "").trim() || null;

  if (!title)          return { error: "Başlık zorunludur." };
  if (isNaN(amount) || amount <= 0) return { error: "Geçerli bir tutar girin." };

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

export async function deleteExpense(id: string): Promise<ExpenseResult> {
  const gate = await requirePermission("reports", "delete");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  await supabase
    .from("expenses")
    .delete()
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  revalidatePath("/app/giderler");
  return { ok: true };
}

export async function listExpenses(month?: string) {
  const gate = await requirePermission("reports", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  let query = supabase
    .from("expenses")
    .select("id, title, amount, category, expense_date, notes, created_at, property:properties(property_code, title)")
    .eq("tenant_id", gate.tenantId)
    .order("expense_date", { ascending: false })
    .limit(200);

  if (month) {
    query = query
      .gte("expense_date", `${month}-01`)
      .lte("expense_date", `${month}-31`);
  }

  const { data } = await query;
  return data ?? [];
}
