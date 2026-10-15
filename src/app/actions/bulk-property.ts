"use server";

import { revalidatePath } from "next/cache";
import { revalidateTenantData } from "@/lib/revalidate";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { createClient } from "@/lib/supabase/server";
import { requestApprovalIfNeeded } from "@/lib/oversight/approval-gate";
import { publishBlockReasons } from "@/lib/property-owner/server";
import { actionErrorMessage } from "@/lib/action-errors";

const MANUAL_STATUSES = ["draft", "live", "reserved", "passive", "withdrawn", "archived"] as const;

export type BulkUpdateResult = {
  ok?: boolean;
  error?: string;
  updatedCount?: number;
  /** Kapıdan geçip RPC'ye giden portföyler (kısmi sonuç; B163). */
  applied?: string[];
  /** Yayın kapısına takılan portföyler ve nedenleri. */
  blocked?: { id: string; label: string; reason: string }[];
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
    return { error: "Satıldı/kiralandı durumları yalnız anlaşma ve Mülk yönetimi akışından seçilebilir." };
  }
  let uniqueIds = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
  if (!uniqueIds.length) return { error: "Güncellenecek portföy seçilmedi." };

  // Yayın kapısı (B163): havuzda bekleyen, il/ilçesi seçilmemiş ya da ilan sahibi kaydı tamamlanmamış ilan yayına
  // alınamaz. Denetim ilan sayısından bağımsız 3 sorguyla (tek paralel tur) yapılır; ilk engelde durulmaz —
  // geçenler uygulanır, takılanlar nedenleriyle döner (kısmi sonuç).
  let blocked: NonNullable<BulkUpdateResult["blocked"]> = [];
  if (newStatus === "live") {
    const reasons = await publishBlockReasons(await createClient(), gate.tenantId, uniqueIds);
    blocked = uniqueIds.filter((id) => reasons.has(id)).map((id) => ({ id, ...reasons.get(id)! }));
    uniqueIds = uniqueIds.filter((id) => !reasons.has(id));
    if (!uniqueIds.length) {
      return { error: blockedSummary(blocked), applied: [], blocked, updatedCount: 0 };
    }
  }

  // Ofis kontrol onay kapisi (varsayilan kapali): arsive alma = ilan silme kapisi (listing_delete).
  // Kapi YALNIZ uygulama katmanidir (bkz. oversight/approval-store.ts). Onayi gecen ilanlar arsivlenir,
  // bekleyen/hata verenler atlanir ve kullaniciya bildirilir (onay tek kullanimlik oldugu icin kismi uygulama).
  let blockedMessage: string | null = null;
  let blockedCount = 0;
  if (newStatus === "archived") {
    const passed: string[] = [];
    for (const id of uniqueIds) {
      const approval = await requestApprovalIfNeeded(gate.tenantId, gate.userId, "listing_delete", {
        entityId: id,
        entityType: "property",
      });
      if (approval.status !== "not_required" && approval.status !== "approved") {
        blockedCount += 1;
        blockedMessage ??= approval.message;
      } else {
        passed.push(id);
      }
    }
    if (!passed.length) return { error: blockedMessage ?? "Onay kapısı işlemi durdurdu." };
    uniqueIds = passed;
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("transition_property_status_atomic", {
    p_tenant_id: gate.tenantId,
    p_actor_id: gate.userId,
    p_property_ids: uniqueIds,
    p_status: newStatus,
    p_reason: "Toplu güncelleme",
  });
  if (error) return { error: actionErrorMessage(error, "Güncelleme başarısız.") };
  const result = data as { outcome?: string; updated_count?: number } | null;
  if (result?.outcome === "not_found") return { error: "Seçilen portföylerden biri bulunamadı." };
  // DB kapısı (aynı kural RPC'de): uygulama denetiminden sonra değişen bir kayıt varsa hiçbiri yayına alınmaz.
  if (result?.outcome === "publish_blocked") {
    return { error: "Seçilen portföylerden biri yayın koşullarını artık karşılamıyor (il, ilçe ve tamamlanmış ilan sahibi kaydı). Sayfayı yenileyip tekrar deneyin." };
  }
  if (result?.outcome === "terminal_requires_workflow") {
    return { error: "Satılmış veya kiralanmış portföy yalnız ilgili anlaşma/Mülk yönetimi iş akışından yeniden açılabilir." };
  }
  if (result?.outcome !== "applied" && result?.outcome !== "replay") return { error: actionErrorMessage(null, "Güncelleme başarısız.") };

  revalidatePath("/app/portfoyler");
  revalidateTenantData(gate.tenantId);
  const updatedCount = Number(result.updated_count ?? 0);
  if (blockedCount > 0) {
    return { error: `${updatedCount} ilan arşivlendi; ${blockedCount} ilan yönetici onayı bekliyor. ${blockedMessage ?? ""}`.trim(), updatedCount };
  }
  if (blocked.length > 0) {
    return { ok: true, updatedCount, applied: uniqueIds, blocked, error: blockedSummary(blocked) };
  }
  return { ok: true, updatedCount, applied: uniqueIds };
}

/** Kapıya takılanların kısa özeti: "2 portföy yayına alınamadı — ES-2610-AB12: Konum eksik ...". */
function blockedSummary(blocked: NonNullable<BulkUpdateResult["blocked"]>): string {
  const shown = blocked.slice(0, 3).map((b) => `${b.label}: ${b.reason}`).join(" · ");
  const more = blocked.length > 3 ? ` · ve ${blocked.length - 3} portföy daha` : "";
  return `${blocked.length} portföy yayına alınamadı — ${shown}${more}`;
}
