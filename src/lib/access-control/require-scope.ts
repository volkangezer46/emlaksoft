/**
 * Scope-aware yetkilendirme kapısı.
 * `requirePermission` üzerine built-in; kapsam kontrol ekler.
 */

import type { AppAction, AppModule, AppRole } from "@/lib/permissions";
import { requirePermission } from "@/lib/require-permission";
import { getUserScope, loadScopeOverrides, checkScopeOverride } from "./scope-cache";
import { evaluateScopeAccess } from "./scope-rules";

export type ScopePermissionGate =
  | {
      ok: true;
      userId: string;
      tenantId: string;
      role: string;
      scope: string;
      branchId?: string | null;
      teamId?: string | null;
      impersonating: boolean;
    }
  | { ok: false; error: string };

/**
 * Kapsam kontrol ile yetkilendirme.
 * Rol × modül × aksiyon + kapsam + resource bağlamı kontrol eder.
 */
export async function requireScopePermission(
  mod: AppModule,
  action: AppAction,
  scopeContext?: {
    resourceType?: "demand" | "property" | "portfolio" | "deal" | "commission" | "report" | "task";
    resourceId?: string;
    targetUserId?: string;
    targetBranchId?: string;
    targetTeamId?: string;
  },
): Promise<ScopePermissionGate> {
  // Önce rol × modül × aksiyon kontrol et (temel yetki)
  const permissionGate = await requirePermission(mod, action);
  if (!permissionGate.ok) {
    return permissionGate as ScopePermissionGate;
  }

  // Eğer scope context yoksa (= genel modül erişimi), temel yetki yeterli
  if (!scopeContext || !scopeContext.resourceType) {
    return {
      ok: true,
      userId: permissionGate.userId,
      tenantId: permissionGate.tenantId,
      role: permissionGate.role,
      scope: "office", // Varsayılan: ofis seviyesi
      impersonating: permissionGate.impersonating,
    };
  }

  // Scope kontrol et
  try {
    const userScope = await getUserScope(permissionGate.userId, permissionGate.tenantId, permissionGate.role as AppRole);
    const overrides = await loadScopeOverrides(permissionGate.userId, permissionGate.tenantId);

    // Override varsa kontrol et
    if (scopeContext.resourceId) {
      const overrideDecision = checkScopeOverride(
        overrides,
        scopeContext.resourceType,
        scopeContext.resourceId,
      );
      if (overrideDecision !== null) {
        if (overrideDecision) {
          return {
            ok: true,
            userId: permissionGate.userId,
            tenantId: permissionGate.tenantId,
            role: permissionGate.role,
            scope: "override",
            branchId: userScope.branch_id,
            teamId: userScope.team_id,
            impersonating: permissionGate.impersonating,
          };
        } else {
          return { ok: false, error: "Kapsam geçersiz kılma işlemi reddedildi" };
        }
      }
    }

    // Scope kurallarını değerlendir
    const accessDecision = evaluateScopeAccess({
      userId: permissionGate.userId,
      tenantId: permissionGate.tenantId,
      userRole: permissionGate.role,
      userScope: userScope.scope_type,
      userBranchId: userScope.branch_id,
      userTeamId: userScope.team_id,
      targetResourceType: scopeContext.resourceType,
      targetResourceId: scopeContext.resourceId,
      targetUserId: scopeContext.targetUserId,
      targetBranchId: scopeContext.targetBranchId,
      targetTeamId: scopeContext.targetTeamId,
      action,
    });

    if (!accessDecision.allowed) {
      return { ok: false, error: accessDecision.reason || "Kapsam erişimi reddedildi" };
    }

    return {
      ok: true,
      userId: permissionGate.userId,
      tenantId: permissionGate.tenantId,
      role: permissionGate.role,
      scope: accessDecision.scope,
      branchId: userScope.branch_id,
      teamId: userScope.team_id,
      impersonating: permissionGate.impersonating,
    };
  } catch (e) {
    console.error("[requireScopePermission] Scope kontrol hatası:", e);
    return { ok: false, error: "Yetkilendirme kontrolü başarısız oldu" };
  }
}
