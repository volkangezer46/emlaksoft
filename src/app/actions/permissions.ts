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

// ========== Kullanıcı bazlı istisnalar (user_permission_overrides) ==========

const VALID_ACTIONS: AppAction[] = ["view", "create", "edit", "delete"];

/** Hedef üyeyi doğrular: aynı tenant'ta olmalı ve owner OLMAMALI (owner daima tam yetkili). */
async function requireOverrideTarget(userId: string) {
  const ctx = await requireRoleManager();
  if ("error" in ctx) return { error: ctx.error } as const;

  const supabase = await createClient();
  const { data: target } = await supabase
    .from("profiles")
    .select("id, tenant_id, role")
    .eq("id", userId)
    .maybeSingle();
  if (!target || target.tenant_id !== ctx.tenantId) return { error: "Üye bu ofise ait değil." } as const;
  if (target.role === "owner") return { error: "Ofis sahibine istisna tanımlanamaz — her zaman tam yetkilidir." } as const;

  return { supabase, tenantId: ctx.tenantId, userId: ctx.userId, targetId: target.id } as const;
}

function revalidateExceptionPaths() {
  revalidatePath("/app/ayarlar/roller");
  revalidatePath("/app");
}

/**
 * Kullanıcının bir modüldeki istisnasını yazar. `actions` o modülün ETKİN aksiyon
 * kümesinin tamamı olur (boş dizi = modül kapalı). `expiresAt` (ISO) verilirse geçici
 * yetkidir — tarih geçince istisna yok sayılır.
 */
export async function setUserPermissionOverride(
  userId: string,
  mod: AppModule,
  actions: AppAction[],
  expiresAt?: string | null,
): Promise<PermissionActionResult> {
  const ctx = await requireOverrideTarget(userId);
  if ("error" in ctx) return { error: ctx.error };

  const cleanActions = Array.from(new Set(actions.filter((a) => VALID_ACTIONS.includes(a))));
  let expiry: string | null = null;
  if (expiresAt) {
    const t = new Date(expiresAt).getTime();
    if (Number.isNaN(t)) return { error: "Geçerli bir bitiş tarihi girin." };
    if (t <= Date.now()) return { error: "Bitiş tarihi gelecekte olmalı." };
    expiry = new Date(t).toISOString();
  }

  const { error } = await ctx.supabase.from("user_permission_overrides").upsert(
    {
      tenant_id: ctx.tenantId,
      user_id: ctx.targetId,
      module: mod,
      actions: cleanActions,
      expires_at: expiry,
      created_by: ctx.userId,
      created_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,user_id,module" },
  );

  if (error) {
    console.error("setUserPermissionOverride", error);
    return { error: "İstisna kaydedilemedi." };
  }

  revalidateExceptionPaths();
  return { ok: true };
}

/** Kullanıcının bir modüldeki istisnasını kaldırır — modül rol iznine geri döner. */
export async function removeUserPermissionOverride(userId: string, mod: AppModule): Promise<PermissionActionResult> {
  const ctx = await requireOverrideTarget(userId);
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase
    .from("user_permission_overrides")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", ctx.targetId)
    .eq("module", mod);

  if (error) {
    console.error("removeUserPermissionOverride", error);
    return { error: "İstisna kaldırılamadı." };
  }

  revalidateExceptionPaths();
  return { ok: true };
}

/** Kullanıcının TÜM istisnalarını temizler — tamamen rol iznine döner. */
export async function clearUserPermissionOverrides(userId: string): Promise<PermissionActionResult> {
  const ctx = await requireOverrideTarget(userId);
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase
    .from("user_permission_overrides")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", ctx.targetId);

  if (error) {
    console.error("clearUserPermissionOverrides", error);
    return { error: "İstisnalar temizlenemedi." };
  }

  revalidateExceptionPaths();
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
