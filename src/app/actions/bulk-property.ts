"use server";

import { revalidatePath } from "next/cache";
import { revalidateTenantData } from "@/lib/revalidate";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { createClient } from "@/lib/supabase/server";
import { publishBlockReason } from "@/lib/property-owner/server";

const MANUAL_STATUSES = ["draft", "live", "reserved", "passive", "withdrawn", "archived"] as const;

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
  if (!(MANUAL_STATUSES as readonly string[]).includes(newStatus)) {
    return { error: "Satıldı/kiralandı durumları yalnız anlaşma ve kiralama akışından seçilebilir." };
  }
  const uniqueIds = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
  if (!uniqueIds.length) return { error: "Güncellenecek portföy seçilmedi." };

  // Yayın kapısı: havuzda bekleyen veya eksik ilan sahibi bilgisi olan ilan yayına alınamaz.
  if (newStatus === "live") {
    const supabase = await createClient();
    for (const id of uniqueIds) {
      const blocked = await publishBlockReason(supabase, gate.tenantId, id);
      if (blocked) return { error: blocked };
    }
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("transition_property_status_atomic", {
    p_tenant_id: gate.tenantId,
    p_actor_id: gate.userId,
    p_property_ids: uniqueIds,
    p_status: newStatus,
    p_reason: "Toplu güncelleme",
  });
  if (error) return { error: "Güncelleme başarısız." };
  const result = data as { outcome?: string; updated_count?: number } | null;
  if (result?.outcome === "not_found") return { error: "Seçilen portföylerden biri bulunamadı." };
  if (result?.outcome === "terminal_requires_workflow") {
    return { error: "Satılmış veya kiralanmış portföy yalnız ilgili anlaşma/kiralama iş akışından yeniden açılabilir." };
  }
  if (result?.outcome !== "applied" && result?.outcome !== "replay") return { error: "Güncelleme başarısız." };

  revalidatePath("/app/portfoyler");
  revalidateTenantData(gate.tenantId);
  return { ok: true, updatedCount: Number(result.updated_count ?? 0) };
}
