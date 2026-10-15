"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { guardPlatformAction } from "@/lib/platform-guards";
import { afterSafe } from "@/lib/after-safe";
import { bustAdminCounters } from "@/lib/admin/counter-tags";
import { logPlatformActivity } from "@/lib/platform-activity";
import { notifyTenant } from "@/lib/notify";
import { isUuid } from "@/lib/support/ticket-contract";
import { actionErrorMessage } from "@/lib/action-errors";
import { mergeErrorMessage, parseMergePayload } from "@/lib/support/ticket-merge";

/**
 * PA-9: mükerrer destek talebini hedef talebe birleştirir (tek RPC transaction'ı `support_merge_tickets`,
 * migration 20261019070001). Kapı: `tickets` modülü YAZMA yetkisi + 30/5 dk oran sınırı. Ofise TEK bildirim gider
 * (kaynak talebi açan kişiye; yanıttan sonra). Kaynak kapanır, SLA'sı durur; hedefin SLA'sı değişmez.
 */
export type MergeTicketResult = { ok?: boolean; error?: string; targetId?: string };

export async function mergeSupportTickets(formData: FormData): Promise<MergeTicketResult> {
  const gate = await guardPlatformAction({ module: "tickets", action: "write", rate: { key: "ticket-merge", limit: 30, windowSec: 300 } });
  if ("error" in gate) return { error: gate.error };
  const staff = gate.staff;
  const sourceId = String(formData.get("source_id") ?? "").trim();
  const targetId = String(formData.get("target_id") ?? "").trim();
  if (!isUuid(sourceId) || !isUuid(targetId)) return { error: "Birleştirilecek talebi seçin." };
  if (sourceId === targetId) return { error: "Talep kendisiyle birleştirilemez." };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("support_merge_tickets", { p_source_id: sourceId, p_target_id: targetId, p_actor_id: staff.id });
  if (error) {
    const known = mergeErrorMessage(error);
    if (!known) console.error("mergeSupportTickets", { code: error.code ?? "unknown" });
    return { error: known ?? actionErrorMessage(error, "Talepler birleştirilemedi.") };
  }
  const payload = parseMergePayload(data);
  if (!payload) return { error: "Talepler birleştirilemedi." };

  await logPlatformActivity({
    actorId: staff.id,
    action: "ticket.merge",
    entityType: "support_ticket",
    entityId: payload.targetId,
    meta: { tenant_id: payload.tenantId, source_id: payload.sourceId, source_no: payload.sourceNo, target_no: payload.targetNo },
  }).catch(() => undefined);

  if (payload.createdBy) {
    const userId = payload.createdBy;
    afterSafe(
      () =>
        notifyTenant({
          tenantId: payload.tenantId,
          userId,
          title: "Destek talepleriniz birleştirildi",
          body: `${payload.sourceNo ?? "Talebiniz"} → ${payload.targetNo ?? "aynı konudaki talep"} · yanıtlar orada sürecek`,
          href: `/app/destek/${payload.targetId}`,
          kind: "info",
          prefKey: "support",
        }),
      "ticket-merge-notify",
    );
  }

  for (const id of [payload.sourceId, payload.targetId]) {
    revalidatePath(`/admin/tickets/${id}`);
    revalidatePath(`/app/destek/${id}`);
  }
  revalidatePath("/admin/tickets");
  revalidatePath("/app/destek");
  bustAdminCounters();
  return { ok: true, targetId: payload.targetId };
}
