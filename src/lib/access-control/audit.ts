/**
 * `access_audit_log` yazıcısı — yalnız DEĞİŞİKLİKLER kaydedilir (aktif kapsam izi/okuma yazılmaz: gürültü yok).
 *
 * İstemci çağırandan gelir (kullanıcı istemcisi: RLS INSERT politikası 20261006000104; cron/rol eşitleme için
 * admin istemci). Satır: kim (created_by), kime (user_id), ne (change_type), önce/sonra (details.before/after),
 * neden (reason). Hata fırlatmaz; sonucu döner — çağıran kritik akışta telafi eder.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type AccessAuditChange =
  | "scope_created"
  | "scope_updated"
  | "scope_deleted"
  | "override_created"
  | "override_updated"
  | "override_deleted"
  | "permission_granted"
  | "permission_revoked";

export type AccessAuditInput = {
  tenantId: string;
  /** Yetkisi değişen kullanıcı. */
  subjectUserId: string;
  /** Değişikliği yapan. */
  actorId: string;
  changeType: AccessAuditChange;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason?: string | null;
  /** Ek bağlam (resource_type/resource_id, module vb.). */
  meta?: Record<string, unknown>;
};

export type AccessAuditResult = { ok: true } | { ok: false; error: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

export async function recordAccessAudit(db: AnyClient, input: AccessAuditInput): Promise<AccessAuditResult> {
  try {
    const { error } = await db.from("access_audit_log").insert({
      tenant_id: input.tenantId,
      user_id: input.subjectUserId,
      change_type: input.changeType,
      details: { ...(input.meta ?? {}), before: input.before, after: input.after },
      reason: input.reason?.trim() || null,
      created_by: input.actorId,
    });
    if (error) {
      console.error("recordAccessAudit", error);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    console.error("recordAccessAudit", e);
    return { ok: false, error: e instanceof Error ? e.message : "Denetim kaydı yazılamadı." };
  }
}
