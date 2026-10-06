"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { PERMISSION_EDITOR_ROLES, type TeamRole } from "@/lib/team/assignable-roles";
import { logActivity } from "@/lib/activity";
import { canEditPermissionOverride } from "@/lib/access-control/admin-rules";
import { recordAccessAudit } from "@/lib/access-control/audit";
import type { AppAction, AppModule, AppRole } from "@/lib/permissions";

export type PermissionActionResult = { error?: string; ok?: boolean };

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
  if (!PERMISSION_EDITOR_ROLES.includes(gate.role as TeamRole)) {
    return { error: "Bu işlem için yetkiniz yok. Sadece ofis sahibi ve genel müdür izin matrisini düzenleyebilir." } as const;
  }
  return { tenantId: gate.tenantId, userId: gate.userId, role: gate.role } as const;
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

  await logActivity({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    action: "permission.role_update",
    entityType: "role_permission",
    newValue: { role, module: mod, action, allowed },
  });

  revalidatePath("/app/ayarlar/roller");
  revalidatePath("/app");
  return { ok: true };
}

// ========== Kullanıcı bazlı istisnalar (user_permission_overrides) ==========

const VALID_ACTIONS: AppAction[] = ["view", "create", "edit", "delete"];

/**
 * Hedef üyeyi doğrular: aynı tenant'ta olmalı, owner OLMAMALI (owner daima tam yetkili) ve aktörün KENDİSİ olmamalı
 * (kendini yükseltme yasağı; saf kural `access-control/admin-rules.ts`).
 */
type OverrideCtx = { supabase: Awaited<ReturnType<typeof createClient>>; tenantId: string; userId: string; targetId: string };

async function requireOverrideTarget(userId: string): Promise<OverrideCtx | { error: string }> {
  const ctx = await requireRoleManager();
  if ("error" in ctx) return { error: ctx.error ?? "Bu işlem için yetkiniz yok." };

  const supabase = await createClient();
  const { data: target } = await supabase
    .from("profiles")
    .select("id, tenant_id, role")
    .eq("id", userId)
    .maybeSingle();
  if (!target || target.tenant_id !== ctx.tenantId) return { error: "Üye bu ofise ait değil." };
  const rule = canEditPermissionOverride({ userId: ctx.userId, role: ctx.role }, { userId: target.id, role: target.role });
  if (!rule.ok) return { error: rule.reason };

  return { supabase, tenantId: ctx.tenantId, userId: ctx.userId, targetId: target.id };
}

/** Önce/sonra için mevcut istisna satırları (modül verilirse yalnız o modül). */
async function readOverrides(ctx: OverrideCtx, mod?: AppModule) {
  let q = ctx.supabase.from("user_permission_overrides").select("module, actions, expires_at").eq("tenant_id", ctx.tenantId).eq("user_id", ctx.targetId);
  if (mod) q = q.eq("module", mod);
  const { data } = await q;
  return (data ?? []) as { module: string; actions: string[]; expires_at: string | null }[];
}

/**
 * Yetki değişikliği denetim izi (`access_audit_log`, önce/sonra). Tablo/politika henüz yoksa ana işlemi bozmaz:
 * izin istisnası sistemi bu tablodan önce vardı; eksikliği yalnız günlükte görünür.
 */
async function auditPermissionChange(
  ctx: OverrideCtx,
  changeType: "permission_granted" | "permission_revoked",
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  meta: Record<string, unknown>,
) {
  await recordAccessAudit(ctx.supabase, {
    tenantId: ctx.tenantId,
    subjectUserId: ctx.targetId,
    actorId: ctx.userId,
    changeType,
    before,
    after,
    meta,
  });
}

function revalidateExceptionPaths() {
  revalidatePath("/app/ayarlar/roller");
  revalidatePath("/app/ayarlar/yetkilendirme");
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

  const before = (await readOverrides(ctx, mod))[0] ?? null;
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

  await auditPermissionChange(
    ctx,
    "permission_granted",
    before ? { actions: before.actions, expires_at: before.expires_at } : null,
    { actions: cleanActions, expires_at: expiry },
    { module: mod },
  );
  revalidateExceptionPaths();
  return { ok: true };
}

/** Kullanıcının bir modüldeki istisnasını kaldırır — modül rol iznine geri döner. */
export async function removeUserPermissionOverride(userId: string, mod: AppModule): Promise<PermissionActionResult> {
  const ctx = await requireOverrideTarget(userId);
  if ("error" in ctx) return { error: ctx.error };

  const before = (await readOverrides(ctx, mod))[0] ?? null;
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

  if (before) await auditPermissionChange(ctx, "permission_revoked", { actions: before.actions, expires_at: before.expires_at }, null, { module: mod });
  revalidateExceptionPaths();
  return { ok: true };
}

/** Kullanıcının TÜM istisnalarını temizler — tamamen rol iznine döner. */
export async function clearUserPermissionOverrides(userId: string): Promise<PermissionActionResult> {
  const ctx = await requireOverrideTarget(userId);
  if ("error" in ctx) return { error: ctx.error };

  const before = await readOverrides(ctx);
  const { error } = await ctx.supabase
    .from("user_permission_overrides")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", ctx.targetId);

  if (error) {
    console.error("clearUserPermissionOverrides", error);
    return { error: "İstisnalar temizlenemedi." };
  }

  if (before.length > 0) await auditPermissionChange(ctx, "permission_revoked", { overrides: before }, null, { module: "*" });
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

  await logActivity({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    action: "permission.role_reset",
    entityType: "role_permission",
    newValue: { role },
  });

  revalidatePath("/app/ayarlar/roller");
  revalidatePath("/app");
  return { ok: true };
}
