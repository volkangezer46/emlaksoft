"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import type { AppAction, AppModule, AppRole } from "@/lib/permissions";

export type PermissionActionResult = { error?: string; ok?: boolean };

const MANAGER_ROLES: AppRole[] = ["owner", "gm"];
// owner rolü daima tam yetkilidir — bu ekrandan düzenlenemez, kendini kilitleme riskine karşı.
const EDITABLE_ROLES: AppRole[] = [
  "gm",
  "branch_manager",
  "team_lead",
  "advisor",
  "call_center",
  "accounting",
  "readonly",
];

async function requireRoleManager() {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error } as const;
  if (!MANAGER_ROLES.includes(gate.role as AppRole)) {
    return { error: "Bu işlem için yetkiniz yok. Sadece ofis sahibi ve genel müdür izin matrisini düzenleyebilir." } as const;
  }
  return { tenantId: gate.tenantId, userId: gate.userId } as const;
}

export async function updateTenantPermission(
  role: AppRole,
  mod: AppModule,
  action: AppAction,
  allowed: boolean,
): Promise<PermissionActionResult> {
  const ctx = await requireRoleManager();
  if ("error" in ctx) return { error: ctx.error };
  if (!EDITABLE_ROLES.includes(role)) return { error: "Bu rol düzenlenemez." };

  const supabase = await createClient();
  const { error } = await supabase.from("tenant_role_permissions").upsert(
    {
      tenant_id: ctx.tenantId,
      role,
      module: mod,
      action,
      allowed,
      updated_by: ctx.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,role,module,action" },
  );

  if (error) {
    console.error("updateTenantPermission", error);
    return { error: "İzin güncellenemedi." };
  }

  revalidatePath("/app/ayarlar/roller");
  revalidatePath("/app");
  return { ok: true };
}

export async function resetRolePermissions(role: AppRole): Promise<PermissionActionResult> {
  const ctx = await requireRoleManager();
  if ("error" in ctx) return { error: ctx.error };
  if (!EDITABLE_ROLES.includes(role)) return { error: "Bu rol düzenlenemez." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("tenant_role_permissions")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("role", role);

  if (error) {
    console.error("resetRolePermissions", error);
    return { error: "Varsayılana döndürülemedi." };
  }

  revalidatePath("/app/ayarlar/roller");
  revalidatePath("/app");
  return { ok: true };
}
