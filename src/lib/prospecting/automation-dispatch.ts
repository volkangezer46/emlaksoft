import "server-only";
import { afterSafe } from "@/lib/after-safe";
import { dispatchAutomationEvent } from "@/lib/automation-engine";

/**
 * Yeni sahibinden ilan kaydı için `new_fsbo_lead` otomasyonlarını tetikler (yanıttan SONRA, hata akışı bozmaz).
 * Yalnız görev / atama / bildirim eylemleri çalışır; mesaj ve kampanya eylemleri motorda FSBO için kapalıdır.
 */
export function dispatchNewFsboLead(input: {
  tenantId: string;
  leadId: string;
  title?: string | null;
  assignedTo?: string | null;
  fields?: Record<string, unknown>;
}): void {
  afterSafe(
    () =>
      dispatchAutomationEvent(input.tenantId, "new_fsbo_lead", {
        entityType: "fsbo_lead",
        entityId: input.leadId,
        label: input.title ?? null,
        assignedTo: input.assignedTo ?? null,
        fields: input.fields ?? {},
      }),
    "automation new_fsbo_lead",
  );
}
