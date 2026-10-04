import { type AppAction, type AppModule } from "@/lib/permissions";
import {
  effectiveHasPermission,
  getEffectivePermissions,
  immutableReadonlyPermissions,
} from "@/lib/permissions-effective";
import { moduleActionBlock } from "@/lib/modules/guard";
import {
  requireActiveTenant,
  type ActiveTenantResult,
} from "@/lib/tenant-guard";

export type PermissionGate =
  | { ok: true; userId: string; tenantId: string; role: string; impersonating: boolean }
  | { ok: false; error: string };

/**
 * Canonical active tenant plus role/module authorization.
 * Platform operations use requirePlatform* separately; inside a tenant,
 * platform staff also receives the canonical tenant role (readonly while impersonating).
 */
export async function requirePermission(
  mod: AppModule,
  action: AppAction,
): Promise<PermissionGate> {
  const gate: ActiveTenantResult = await requireActiveTenant();
  if (!gate.ok) return gate;

  const role = gate.role;
  const perms = gate.impersonating
    ? immutableReadonlyPermissions()
    : await getEffectivePermissions(gate.tenantId, role, gate.userId);
  if (!effectiveHasPermission(perms, mod, action)) {
    return { ok: false, error: "Bu işlem için yetkiniz yok." };
  }

  // Sıra: oturum -> yetki -> modül. Ofisin kapattığı modülün yazma eylemleri doğrudan POST ile de reddedilir.
  const moduleBlock = await moduleActionBlock(gate.tenantId, mod, action);
  if (moduleBlock) return { ok: false, error: moduleBlock };

  return {
    ok: true,
    userId: gate.userId,
    tenantId: gate.tenantId,
    role,
    impersonating: gate.impersonating,
  };
}
