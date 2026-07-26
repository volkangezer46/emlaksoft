"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";

export type ExpenseResult = { ok?: boolean; error?: string; id?: string };

export async function createExpense(
  _prev: ExpenseResult,
  fd: FormData,
): Promise<ExpenseResult> {
  const gate = await requirePermission("expenses", "create");
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

export async function updateExpense(
  _prev: ExpenseResult,
  fd: FormData,
): Promise<ExpenseResult> {
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(fd.get("id") ?? "").trim();
  if (!id) return { error: "Kayıt bulunamadı." };

  const title       = String(fd.get("title")       ?? "").trim();
  const amount      = parseFloat(String(fd.get("amount") ?? "0"));
  const category    = String(fd.get("category")    ?? "diger").trim();
  const expenseDate = String(fd.get("expense_date") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const notes       = String(fd.get("notes")       ?? "").trim() || null;
  const propertyId  = String(fd.get("property_id") ?? "").trim() || null;

  if (!title)          return { error: "Başlık zorunludur." };
  if (isNaN(amount) || amount <= 0) return { error: "Geçerli bir tutar girin." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("expenses")
    .update({ title, amount, category, expense_date: expenseDate, notes, property_id: propertyId })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) return { error: "Gider güncellenemedi." };

  revalidatePath("/app/giderler");
  return { ok: true, id };
}

export async function deleteExpense(id: string): Promise<ExpenseResult> {
  const gate = await requirePermission("expenses", "delete");
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

  const { data } = await query;
  return data ?? [];
}

/**
 * Son 6 ayın gider kayıtları (tutar + tarih) — aylık trend grafiği için.
 * Sayfadaki tarih/kategori filtresinden bağımsız çalışır.
 */
export async function listExpenseMonthlyTrend() {
  const gate = await requirePermission("expenses", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const from = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-01`;

  const { data } = await supabase
    .from("expenses")
    .select("amount, expense_date")
    .eq("tenant_id", gate.tenantId)
    .gte("expense_date", from)
    .limit(5000);

  return (data ?? []) as { amount: number; expense_date: string }[];
}
