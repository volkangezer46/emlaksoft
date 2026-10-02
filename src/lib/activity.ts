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

export type AuditResult = { ok: true } | { ok: false; error: string };

async function writeActivity(input: AuditInput): Promise<AuditResult> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("audit_logs").insert({
      tenant_id: input.tenantId,
      actor_id: input.actorId ?? null,
      action: input.action,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      old_value: input.oldValue ?? null,
      new_value: input.newValue ?? null,
    });
    if (error) {
      console.error("logActivity", error);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    console.error("logActivity", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Audit kaydı yazılamadı.",
    };
  }
}

/**
 * Operasyonel audit: yazma hatasını görünür kılar, ana iş akışını bozmaz.
 * Güvenlik/billing gibi audit olmadan tamamlanmaması gereken akışlar aşağıdaki
 * strict varyantı veya mutasyonla aynı DB transaction'ındaki audit insertini
 * kullanmalıdır.
 */
export async function logActivity(input: AuditInput): Promise<AuditResult> {
  return writeActivity(input);
}

/** Kritik akışlarda audit kaydı oluşmadan başarı dönülmesini engeller. */
export async function logActivityOrThrow(input: AuditInput): Promise<void> {
  const result = await writeActivity(input);
  if (!result.ok) throw new Error("Kritik işlem audit kaydı oluşturulamadı.");
}
