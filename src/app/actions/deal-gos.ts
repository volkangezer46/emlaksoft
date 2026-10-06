"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { isMissingDealGosColumn, parseDealGosInput } from "@/lib/deal-gos";

export type DealGosResult = { ok?: boolean; error?: string };

/**
 * Anlaşmaya GÖS referans no + tapu randevu tarihi yazar (yalnız satış anlaşması).
 * Kolon yoksa (20261007000300 uygulanmadı) "etkin değil" döner; kayıt bozulmaz.
 */
export async function updateDealGos(_prev: DealGosResult, formData: FormData): Promise<DealGosResult> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };
  const dealId = String(formData.get("deal_id") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(dealId)) return { error: "Anlaşma bulunamadı." };
  const parsed = parseDealGosInput(formData.get("gos_reference_no"), formData.get("title_deed_appointment_at"));
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const { data: deal } = await supabase
    .from("deals")
    .select("id, deal_type")
    .eq("id", dealId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!deal) return { error: "Anlaşma bulunamadı." };
  if (deal.deal_type !== "sale") return { error: "GÖS alanları yalnız satış anlaşmalarında kullanılır." };

  const { error } = await supabase
    .from("deals")
    .update({
      gos_reference_no: parsed.value.referenceNo,
      title_deed_appointment_at: parsed.value.titleDeedAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", dealId)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    if (isMissingDealGosColumn(error)) return { error: "GÖS alanları henüz etkin değil (veritabanı güncellemesi bekleniyor)." };
    console.error("updateDealGos", error.code);
    return { error: "Kaydedilemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "deal.gos_update",
    entityType: "deal",
    entityId: dealId,
    newValue: { gos_reference_no: parsed.value.referenceNo, title_deed_appointment_at: parsed.value.titleDeedAt },
  });
  revalidatePath(`/app/anlasmalar/${dealId}`);
  return { ok: true };
}
