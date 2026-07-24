"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";

export type CommissionSplitInput = { label: string; rate: number };
export type CommissionResult = { ok?: boolean; error?: string };

/**
 * Komisyon paylaşımını (çok taraflı split) günceller. Oranlar (%) verilir,
 * tutarlar brüt komisyondan otomatik hesaplanır. Toplam oran %100'ü aşamaz.
 */
export async function updateCommissionSplits(
  commissionId: string,
  rows: CommissionSplitInput[],
): Promise<CommissionResult> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };

  const clean = rows
    .map((r) => ({ label: String(r.label ?? "").trim(), rate: Number(r.rate) || 0 }))
    .filter((r) => r.label && r.rate > 0);

  if (clean.length === 0) return { error: "En az bir geçerli paylaşım satırı girin." };
  const totalRate = clean.reduce((s, r) => s + r.rate, 0);
  if (totalRate > 100.01) return { error: `Toplam oran %100'ü aşamaz (şu an %${totalRate.toFixed(1)}).` };

  const supabase = await createClient();
  const { data: commission } = await supabase
    .from("commissions")
    .select("gross_amount")
    .eq("id", commissionId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!commission) return { error: "Komisyon kaydı bulunamadı." };

  const gross = Number(commission.gross_amount) || 0;
  const splits = clean.map((r) => ({
    label: r.label,
    rate: r.rate,
    amount: Math.round(gross * (r.rate / 100) * 100) / 100,
  }));

  const { error } = await supabase
    .from("commissions")
    .update({ splits })
    .eq("id", commissionId)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("updateCommissionSplits", error);
    return { error: "Paylaşım güncellenemedi." };
  }

  revalidatePath("/app/komisyon");
  return { ok: true };
}
