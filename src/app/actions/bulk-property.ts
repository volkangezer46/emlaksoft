"use server";

import { revalidatePath } from "next/cache";
import { revalidateTenantData } from "@/lib/revalidate";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { createClient } from "@/lib/supabase/server";
import { requestApprovalIfNeeded } from "@/lib/oversight/approval-gate";
import { publishBlockReasons } from "@/lib/property-owner/server";
import { actionErrorMessage } from "@/lib/action-errors";
import { afterSafe } from "@/lib/after-safe";
import { logActivity } from "@/lib/activity";
import { idsDigest, notifyAssignment } from "@/lib/assignment-notify";
import { trDayKey } from "@/lib/clock";
import { isSalesAssigneeRole } from "@/lib/team/assignable-roles";
import { notifyMatchesForPublishedProperties } from "@/lib/match-notify";

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
  if (newStatus === "live" && updatedCount > 0) {
    // Toplu yayına alınan portföyler açık taleplerle yeniden eşleşir (CRM-G5); danışman başına tek özet bildirim.
    const published = uniqueIds;
    afterSafe(() => notifyMatchesForPublishedProperties(gate.tenantId, gate.userId, published), "toplu yayın eşleşme");
  }
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

const BULK_ASSIGN_LIMIT = 200;

export type BulkAssignPropertiesResult = { ok?: boolean; error?: string; updatedCount?: number };

/**
 * Toplu sorumlu değiştirme (bkz. `bulkAssignCustomers` deseni): seçili portföyler aynı danışmana devredilir.
 * Kapı `properties.edit`; kimlikler ofis + silinmemiş süzgecinden geçer; hedef bu ofisin AKTİF satış rolündeki
 * kullanıcısı olmalı (müşteri devriyle aynı kural). Tek denetim kaydı (`property.reassign`, toplu temsil) ve el
 * değiştiren portföy varsa hedefe tek seferlik bildirim.
 */
export async function bulkAssignProperties(ids: string[], assignedTo: string): Promise<BulkAssignPropertiesResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };
  const list = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id).trim()).filter(Boolean))];
  if (!list.length) return { error: "Portföy seçilmedi." };
  if (list.length > BULK_ASSIGN_LIMIT) return { error: `Tek seferde en fazla ${BULK_ASSIGN_LIMIT} portföy güncellenebilir.` };
  const target = String(assignedTo ?? "").trim();
  if (!target) return { error: "Danışman seçin." };

  const supabase = await createClient();
  const [targetRes, beforeRes] = await Promise.all([
    supabase.from("profiles").select("id, role").eq("id", target).eq("tenant_id", gate.tenantId).eq("is_active", true).maybeSingle(),
    supabase.from("properties").select("id, assigned_to").in("id", list).eq("tenant_id", gate.tenantId).is("deleted_at", null),
  ]);
  const targetRow = targetRes.data as { id: string; role: string | null } | null;
  if (!targetRow) return { error: "Seçilen danışman bu ofiste aktif değil." };
  if (!isSalesAssigneeRole(targetRow.role)) return { error: "Bu kullanıcının rolüne portföy atanamaz (yalnız satış rolleri)." };
  const previous = ((beforeRes.data ?? []) as { id: string; assigned_to: string | null }[]);
  const validIds = previous.map((p) => p.id);
  if (!validIds.length) return { error: "Güncellenecek portföy bulunamadı." };
  const movedCount = previous.filter((p) => (p.assigned_to ?? "") !== target).length;

  const { error } = await supabase
    .from("properties")
    .update({ assigned_to: target, updated_at: new Date().toISOString() })
    .in("id", validIds)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("bulkAssignProperties", error);
    return { error: actionErrorMessage(error, "Danışman ataması yapılamadı.") };
  }
  if (target !== gate.userId && movedCount > 0) {
    await notifyAssignment({
      tenantId: gate.tenantId,
      userId: target,
      title: movedCount === 1 ? "Size 1 portföy devredildi" : `Size ${movedCount} portföy devredildi`,
      body: "Toplu atama ile portföyler size devredildi. Malik ve ilan durumunu kontrol edip ilk adımı planlayın.",
      href: "/app/portfoyler",
      dedupeKey: `property-bulk-assign:${target}:${idsDigest(validIds)}:${trDayKey()}`,
    });
  }
  afterSafe(() => logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.reassign",
    entityType: "property",
    oldValue: { previous },
    newValue: { ids: validIds, assigned_to: target, count: validIds.length, bulk: true },
  }));

  revalidatePath("/app/portfoyler");
  revalidateTenantData(gate.tenantId);
  return { ok: true, updatedCount: validIds.length };
}
