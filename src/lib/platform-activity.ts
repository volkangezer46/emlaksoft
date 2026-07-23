import { createAdminClient } from "@/lib/supabase/admin";

export type PlatformAuditInput = {
  actorId: string;
  action: string;
  entityType?: string;
  entityId?: string | null;
  meta?: Record<string, unknown> | null;
};

/**
 * Platform personel işlemlerini platform_audit_logs'a kaydeder.
 * Service role kullanır, RLS bypass eder.
 * Hata olsa dahi işlemi durdurmaz (fire-and-forget pattern).
 */
export async function logPlatformActivity(input: PlatformAuditInput): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("platform_audit_logs").insert({
      actor_id: input.actorId,
      action: input.action,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      meta: input.meta ?? null,
    });
  } catch (e) {
    // Audit kaydı başarısız olsa da asıl işlem etkilenmemeli
    console.error("logPlatformActivity", e);
  }
}
