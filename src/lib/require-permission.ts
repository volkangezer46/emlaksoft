import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { getPlatformStaff } from "@/lib/platform";
import { type AppAction, type AppModule } from "@/lib/permissions";
import { effectiveHasPermission, getEffectivePermissions } from "@/lib/permissions-effective";
import { requireActiveTenant, type ActiveTenantResult } from "@/lib/tenant-guard";

export type PermissionGate =
  | { ok: true; userId: string; tenantId: string; role: string }
  | { ok: false; error: string };

/**
 * Aktif tenant + rol×modül kontrolü (DB-tabanlı etkin izinlerle, bkz. `getEffectivePermissions`).
 * Platform staff kendi ops oturumunda geçer; impersonation’da readonly JWT ile sınırlanır.
 */
export async function requirePermission(mod: AppModule, action: AppAction): Promise<PermissionGate> {
  const gate: ActiveTenantResult = await requireActiveTenant();
  if (!gate.ok) return gate;

  const staff = await getPlatformStaff();
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", gate.userId).maybeSingle();
  const role = String(profile?.role ?? "advisor");

  if (staff) {
    const user = await getRequestUser();
    const impersonating = Boolean(user?.app_metadata?.impersonating);
    if (!impersonating) {
      return { ok: true, userId: gate.userId, tenantId: gate.tenantId, role };
    }
  }

  const perms = await getEffectivePermissions(gate.tenantId, role, gate.userId);
  if (!effectiveHasPermission(perms, mod, action)) {
    return { ok: false, error: "Bu işlem için yetkiniz yok." };
  }

  return { ok: true, userId: gate.userId, tenantId: gate.tenantId, role };
}
