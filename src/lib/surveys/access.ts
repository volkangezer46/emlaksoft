import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEffectivePermissions, effectiveHasPermission } from "@/lib/permissions-effective";
import { isModuleEnabled } from "@/lib/modules/state";
import { hasOfficeWideDataScope } from "@/lib/team/assignable-roles";

/**
 * Anketör erişimi. Anketör bir ROL değil, ofis sahibinin atadığı görevdir (`survey_assignees`).
 * Kuyruğu çalıştırabilen: (a) anketör olarak atanmış kullanıcı (yalnız kendine atanan görevler),
 * (b) `surveys` modülünde düzenleme yetkisi olan yönetici (tüm görevler).
 * Çağıran action ÖNCE `requirePermission("surveys", ...)` kapısından geçmiş olmalıdır.
 */
export type WorkerAccess =
  | { ok: true; canManage: boolean; isSurveyor: boolean; officeWide: boolean }
  | { ok: false; error: string };

export async function resolveWorkerAccess(
  supabase: SupabaseClient,
  gate: { tenantId: string; userId: string; role: string },
): Promise<WorkerAccess> {
  if (!(await isModuleEnabled(gate.tenantId, "surveys"))) {
    return { ok: false, error: "Anketler modülü bu ofiste kapalı. Ofis sahibi Ayarlar > Modüller bölümünden açabilir." };
  }
  const perms = await getEffectivePermissions(gate.tenantId, gate.role, gate.userId);
  // Yönetici: ofis geneli kapsamlı rol + düzenleme izni (çağrı merkezi gibi roller anketör atamasıyla çalışır).
  const canManage = effectiveHasPermission(perms, "surveys", "edit") && hasOfficeWideDataScope(gate.role);
  const { data } = await supabase
    .from("survey_assignees")
    .select("user_id")
    .eq("tenant_id", gate.tenantId)
    .eq("user_id", gate.userId)
    .maybeSingle();
  const isSurveyor = Boolean(data);
  if (!canManage && !isSurveyor) {
    return { ok: false, error: "Bu işlem için anketör olarak atanmış olmanız gerekir." };
  }
  return { ok: true, canManage, isSurveyor, officeWide: hasOfficeWideDataScope(gate.role) };
}

/** Anketör kendine atanmamış görevi çalıştıramaz; yönetici hepsini çalıştırır. */
export function canWorkTask(access: { canManage: boolean }, userId: string, assignedTo: string | null): boolean {
  return access.canManage || assignedTo === userId;
}
