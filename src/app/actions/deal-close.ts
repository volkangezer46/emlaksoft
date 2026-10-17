"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { dealWriteScopeFilter, OUT_OF_SCOPE_RECORD, scopeFilterAllowsOwner } from "@/lib/permission-data-scope";
import { isUuid } from "@/lib/finance/cash/input";

/**
 * Kapanış sihirbazı (salt okuma): "Kazanıldı" sonrası atomik işlemin açtığı komisyon kaydının kimliği — paylar
 * `updateCommissionSplits` ile bu kayda yazılır. İş kuralı yok; kapı + kiracı + anlaşma yazma kapsamı (WP2).
 */
export async function getDealCommissionRef(dealId: string): Promise<{ id?: string; error?: string }> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!isUuid(String(dealId ?? ""))) return { error: "Anlaşma bulunamadı." };

  const supabase = await createClient();
  const { data: deal } = await supabase
    .from("deals")
    .select("id, assigned_to")
    .eq("id", dealId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!deal) return { error: "Anlaşma bulunamadı." };
  if (!scopeFilterAllowsOwner(await dealWriteScopeFilter(gate), [(deal.assigned_to as string | null) ?? null])) {
    return { error: OUT_OF_SCOPE_RECORD };
  }
  const { data } = await supabase
    .from("commissions")
    .select("id")
    .eq("deal_id", dealId)
    .eq("tenant_id", gate.tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ? { id: data.id as string } : { error: "Komisyon kaydı bulunamadı." };
}
