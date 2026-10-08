"use server";

import { revalidatePath } from "next/cache";
import { revalidateTenantData } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { getDefinitionsOrDefault } from "@/lib/definitions";
import { logActivity } from "@/lib/activity";
import { actionErrorMessage } from "@/lib/action-errors";
import { now } from "@/lib/clock";
import { parseBudgetAmount } from "@/lib/finance/expense-budget";
import { isMissingFinanceSchema } from "@/lib/finance/load";

export type ExpenseBudgetResult = { ok?: boolean; error?: string };

const MISSING = "Bütçe özelliği için veritabanı güncellemesi bekleniyor. Yöneticinizle iletişime geçin.";

/** Kategori için aylık bütçe belirler/günceller (giderler:düzenle). Boş tutar bütçeyi kaldırır. */
export async function saveExpenseBudget(_prev: ExpenseBudgetResult, formData: FormData): Promise<ExpenseBudgetResult> {
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { error: gate.error };

  const category = String(formData.get("category") ?? "").trim();
  const defs = await getDefinitionsOrDefault("expense_category");
  if (!category || !defs.some((d) => d.value === category)) return { error: "Geçerli bir gider kategorisi seçin." };

  const rawAmount = String(formData.get("monthly_amount") ?? "").trim();
  const supabase = await createClient();

  if (!rawAmount) {
    const { error } = await supabase.from("expense_budgets").delete().eq("tenant_id", gate.tenantId).eq("category", category);
    if (error) return { error: isMissingFinanceSchema(error) ? MISSING : actionErrorMessage(error, "Bütçe kaldırılamadı.") };
    await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "expense_budget.remove", entityType: "expense_budget", oldValue: { category } });
  } else {
    const amount = parseBudgetAmount(rawAmount);
    if (amount === null) return { error: "Bütçe tutarı sıfırdan büyük, geçerli bir sayı olmalı." };
    const { error } = await supabase
      .from("expense_budgets")
      .upsert(
        { tenant_id: gate.tenantId, category, monthly_amount: amount, created_by: gate.userId, updated_at: new Date(now()).toISOString() },
        { onConflict: "tenant_id,category" },
      );
    if (error) return { error: isMissingFinanceSchema(error) ? MISSING : actionErrorMessage(error, "Bütçe kaydedilemedi.") };
    await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "expense_budget.set", entityType: "expense_budget", newValue: { category, monthly_amount: amount } });
  }

  revalidatePath("/app/giderler");
  revalidateTenantData(gate.tenantId);
  return { ok: true };
}
