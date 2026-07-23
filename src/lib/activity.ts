import { createAdminClient } from "@/lib/supabase/admin";

export type AuditInput = {
  tenantId: string;
  actorId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string | null;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
};

/** Kritik yazmaları audit_logs'a kaydeder (service role — RLS insert yedeği). */
export async function logActivity(input: AuditInput) {
  try {
    const admin = createAdminClient();
    await admin.from("audit_logs").insert({
      tenant_id: input.tenantId,
      actor_id: input.actorId ?? null,
      action: input.action,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      old_value: input.oldValue ?? null,
      new_value: input.newValue ?? null,
    });
  } catch (e) {
    console.error("logActivity", e);
  }
}
