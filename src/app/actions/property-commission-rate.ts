"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { parseMoneyInput } from "@/lib/money-input";
import { actionErrorMessage } from "@/lib/action-errors";

export type CommissionRateResult = { ok: true; rate: number } | { ok: false; error: string };

/**
 * Kapanış sihirbazından portföyün komisyon oranını TEK alan olarak yazar (portföy formuna gitmeden).
 *
 * Kapılar: `properties.edit`; oran 0'dan büyük, en çok 100 ve en çok iki ondalık; yazma kiracı sınırlıdır.
 * Mevcut oran DÜŞÜRÜLEMEZ (indirim ofis kontrol onay kapısına tabidir; portföy düzenleme ekranından yapılır).
 * Başarılı yazma `audit_logs`'a düşer.
 */
export async function updatePropertyCommissionRate(
  propertyId: string,
  rateInput: string | number,
): Promise<CommissionRateResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { ok: false, error: gate.error };

  const id = String(propertyId ?? "").trim();
  if (!id) return { ok: false, error: "Portföy bulunamadı." };

  const parsed = parseMoneyInput(rateInput, { max: 100 });
  if (!parsed.ok || parsed.value == null || !(parsed.value > 0) || parsed.value > 100) {
    return { ok: false, error: "Komisyon oranı 0'dan büyük, en fazla 100 ve en çok iki ondalık haneli olmalıdır." };
  }
  const rate = parsed.value;

  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase
    .from("properties")
    .select("id, commission_rate")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (readError || !existing) return { ok: false, error: "Portföy bulunamadı." };

  const oldRate = existing.commission_rate != null ? Number(existing.commission_rate) : null;
  if (oldRate != null && Number.isFinite(oldRate) && rate < oldRate) {
    return { ok: false, error: "Mevcut oranı düşürmek için portföy düzenleme ekranını kullanın (onay kuralı uygulanır)." };
  }

  const { error } = await supabase
    .from("properties")
    .update({ commission_rate: rate })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("updatePropertyCommissionRate", error);
    return { ok: false, error: actionErrorMessage(error, "Komisyon oranı kaydedilemedi.") };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.commission_rate",
    entityType: "property",
    entityId: id,
    oldValue: { commission_rate: oldRate },
    newValue: { commission_rate: rate, source: "closing_wizard" },
  });

  revalidatePath(`/app/portfoyler/${id}`);
  revalidatePath("/app/anlasmalar");
  return { ok: true, rate };
}
