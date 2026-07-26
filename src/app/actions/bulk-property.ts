"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";

export type BulkUpdateResult = {
  ok?: boolean;
  error?: string;
  updatedCount?: number;
};

/**
 * Birden fazla portföyün durumunu toplu olarak günceller.
 * Her güncelleme için durum geçmişi kaydı yazılır.
 */
export async function bulkUpdatePropertyStatus(
  ids: string[],
  newStatus: string,
): Promise<BulkUpdateResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!ids.length) return { error: "Güncellenecek portföy seçilmedi." };
  if (ids.length > 50) return { error: "Tek seferde en fazla 50 portföy güncellenebilir." };

  const supabase = await createClient();

  // Sadece bu tenanta ait portföyleri güncelle (güvenlik)
  const { data: existing } = await supabase
    .from("properties")
    .select("id, status, published_at")
    .in("id", ids)
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null);

  if (!existing?.length) return { error: "Güncellenecek portföy bulunamadı." };

  const validIds = existing.map((p) => p.id);
  const now = new Date().toISOString();

  // Toplu güncelle — live'a geçişte İLK kez yayınlananlar published_at
  // damgası alır; published_at'i zaten dolu olanlara DOKUNULMAZ (yeniden
  // yayına almada orijinal yayın tarihi korunur). İki ayrı update ile.
  const firstLiveIds =
    newStatus === "live" ? existing.filter((p) => p.published_at == null).map((p) => p.id) : [];
  const restIds = validIds.filter((id) => !firstLiveIds.includes(id));

  if (firstLiveIds.length) {
    const { error } = await supabase
      .from("properties")
      .update({ status: newStatus, updated_at: now, published_at: now })
      .in("id", firstLiveIds)
      .eq("tenant_id", gate.tenantId);
    if (error) return { error: "Güncelleme başarısız." };
  }
  if (restIds.length) {
    const { error } = await supabase
      .from("properties")
      .update({ status: newStatus, updated_at: now })
      .in("id", restIds)
      .eq("tenant_id", gate.tenantId);
    if (error) return { error: "Güncelleme başarısız." };
  }

  // Durum geçmişi kayıtları (toplu insert)
  const historyRows = existing.map((p) => ({
    property_id: p.id,
    tenant_id:   gate.tenantId,
    old_status:  p.status ?? null,
    new_status:  newStatus,
    reason:      "Toplu güncelleme",
    changed_by:  gate.userId,
  }));

  await supabase.from("property_status_history").insert(historyRows);

  // Audit log (tek kayıt, toplu temsil)
  await logActivity({
    tenantId:   gate.tenantId,
    actorId:    gate.userId,
    action:     "property.bulk_status",
    entityType: "property",
    newValue:   { ids: validIds, new_status: newStatus, count: validIds.length },
  });

  revalidatePath("/app/portfoyler");
  return { ok: true, updatedCount: validIds.length };
}
