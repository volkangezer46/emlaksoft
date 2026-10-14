"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { guardPlatformAction } from "@/lib/platform-guards";
import { logPlatformActivity } from "@/lib/platform-activity";
import { requireStepUp } from "@/lib/platform-security/step-up";
import { actionErrorMessage } from "@/lib/action-errors";
import { isPlatformBaseRole, normalizeMatrix, type PlatformBaseRole, type PlatformPermissionMatrix } from "@/lib/platform-access";
import { now } from "@/lib/clock";

/**
 * DG1 personel özel rolleri (Personel > Roller). Rol oluşturma/düzenleme/silme YALNIZ süper admin + doğrulayıcı kodu:
 * matris değişikliği o rolü taşıyan herkesin yetkisini değiştirir (yetki yükseltme yolu). Atama `updateStaffRole`'dadır
 * (personel modülünde onay yetkisi + kod + isteğe bağlı dört göz).
 */

export type CustomRoleRow = {
  id: string;
  label: string;
  description: string | null;
  base_role: PlatformBaseRole;
  permissions: PlatformPermissionMatrix;
  holders: number;
  updated_at: string;
};

export type RolesListResult = { ok: true; roles: CustomRoleRow[] } | { ok: false; pending?: boolean; error: string };
export type RoleActionResult = { ok?: boolean; error?: string; id?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCHEMA_PENDING = new Set(["42P01", "42703", "PGRST205", "PGRST204", "PGRST200"]);
const PENDING_MSG = "Özel roller henüz kurulmadı (veritabanı güncellemesi bekliyor).";
const RATE = { key: "platform-custom-roles", limit: 30, windowSec: 600 } as const;

/** Özel rol listesi + kaç aktif personelde kullanıldığı (Personel listesi rol seçimi ve Roller ekranı). */
export async function listCustomRoles(): Promise<RolesListResult> {
  await requirePlatformModule("personel", "view");
  const admin = createAdminClient();
  const [roles, holders] = await Promise.all([
    admin.from("platform_custom_roles").select("id, label, description, base_role, permissions, updated_at").order("label"),
    admin.from("platform_staff").select("custom_role_id").not("custom_role_id", "is", null),
  ]);
  if (roles.error) {
    return SCHEMA_PENDING.has(roles.error.code ?? "") ? { ok: false, pending: true, error: PENDING_MSG } : { ok: false, error: "Roller okunamadı; sayfayı yenileyip tekrar deneyin." };
  }
  const count = new Map<string, number>();
  for (const r of holders.data ?? []) {
    const id = r.custom_role_id as string;
    count.set(id, (count.get(id) ?? 0) + 1);
  }
  return {
    ok: true,
    roles: (roles.data ?? []).map((r) => ({
      id: r.id as string,
      label: r.label as string,
      description: (r.description as string | null) ?? null,
      base_role: isPlatformBaseRole(r.base_role) ? r.base_role : "support",
      permissions: normalizeMatrix(r.permissions),
      holders: count.get(r.id as string) ?? 0,
      updated_at: r.updated_at as string,
    })),
  };
}

export type SaveRoleInput = {
  id?: string | null;
  label: string;
  description?: string | null;
  baseRole: string;
  permissions: Record<string, readonly string[]>;
  stepUpCode?: string | null;
};

/** Yeni özel rol ya da mevcut rolün adı/taban rolü/matrisi (süper admin + kod). */
export async function saveCustomRole(input: SaveRoleInput): Promise<RoleActionResult> {
  const gate = await guardPlatformAction({ module: "personel", action: "approve", roles: ["super_admin"], rate: RATE });
  if ("error" in gate) return { error: gate.error };

  const label = String(input.label ?? "").trim().replace(/\s+/g, " ");
  const description = String(input.description ?? "").trim().slice(0, 300) || null;
  const id = input.id ? String(input.id) : null;
  if (label.length < 2 || label.length > 60) return { error: "Rol adı 2 ile 60 karakter arasında olmalıdır." };
  if (!isPlatformBaseRole(input.baseRole)) return { error: "Taban rol Operasyon, Müşteri temsilcisi ya da Muhasebe olmalıdır." };
  if (id && !UUID_RE.test(id)) return { error: "Geçersiz rol." };
  const permissions = normalizeMatrix(input.permissions);
  if (Object.keys(permissions).length <= 1) return { error: "En az bir ekran için yetki seçin (Genel bakış herkeste açıktır)." };

  const su = await requireStepUp({ code: input.stepUpCode }, "staff_role", gate.staff.id);
  if (!su.ok) return { error: su.error };

  const admin = createAdminClient();
  const stamp = new Date(now()).toISOString();
  const row = { label, description, base_role: input.baseRole, permissions, updated_by: gate.staff.id, updated_at: stamp };
  let before: unknown = null;
  let savedId = id;
  if (id) {
    const { data: prev } = await admin.from("platform_custom_roles").select("label, base_role, permissions").eq("id", id).maybeSingle();
    if (!prev) return { error: "Rol bulunamadı." };
    before = prev;
    const { error } = await admin.from("platform_custom_roles").update(row).eq("id", id);
    if (error) return { error: roleWriteError(error) };
    // Taban rol değiştiyse rolü taşıyan personelin `role` sütunu da güncellenir (ince kurallar taban rolden gelir).
    const { error: holdersError } = await admin.from("platform_staff").update({ role: input.baseRole, updated_at: stamp }).eq("custom_role_id", id);
    if (holdersError) return { error: actionErrorMessage(holdersError, "Rol kaydedildi ancak taşıyan personelin taban rolü güncellenemedi; tekrar kaydedin.") };
  } else {
    const { data, error } = await admin
      .from("platform_custom_roles")
      .insert({ ...row, created_by: gate.staff.id })
      .select("id")
      .single();
    if (error || !data) return { error: roleWriteError(error) };
    savedId = data.id as string;
  }

  await logPlatformActivity({
    actorId: gate.staff.id,
    action: id ? "platform_role.update" : "platform_role.create",
    entityType: "platform_custom_role",
    entityId: savedId,
    before: before as Record<string, unknown> | null,
    after: { label, base_role: input.baseRole, permissions },
  });
  revalidatePath("/admin/personel/roller");
  revalidatePath("/admin/personel");
  return { ok: true, id: savedId ?? undefined };
}

/** Özel rolü siler (yalnız kullanılmıyorsa; DB FK on delete restrict ayrıca korur). */
export async function deleteCustomRole(input: { id: string; stepUpCode?: string | null }): Promise<RoleActionResult> {
  const gate = await guardPlatformAction({ module: "personel", action: "approve", roles: ["super_admin"], rate: RATE });
  if ("error" in gate) return { error: gate.error };
  const id = String(input.id ?? "");
  if (!UUID_RE.test(id)) return { error: "Geçersiz rol." };
  const su = await requireStepUp({ code: input.stepUpCode }, "staff_role", gate.staff.id);
  if (!su.ok) return { error: su.error };

  const admin = createAdminClient();
  const { count } = await admin.from("platform_staff").select("id", { count: "exact", head: true }).eq("custom_role_id", id);
  if ((count ?? 0) > 0) return { error: "Bu rol personelde kullanılıyor; önce o personelin rolünü değiştirin." };
  const { data: prev } = await admin.from("platform_custom_roles").select("label, base_role, permissions").eq("id", id).maybeSingle();
  if (!prev) return { error: "Rol bulunamadı." };
  const { error } = await admin.from("platform_custom_roles").delete().eq("id", id);
  if (error) return { error: error.code === "23503" ? "Bu rol personelde kullanılıyor; önce o personelin rolünü değiştirin." : roleWriteError(error) };

  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "platform_role.delete",
    entityType: "platform_custom_role",
    entityId: id,
    before: prev as Record<string, unknown>,
  });
  revalidatePath("/admin/personel/roller");
  revalidatePath("/admin/personel");
  return { ok: true };
}

function roleWriteError(error: { code?: string } | null): string {
  if (error?.code === "23505") return "Bu adla bir rol zaten var.";
  if (SCHEMA_PENDING.has(error?.code ?? "")) return PENDING_MSG;
  return actionErrorMessage(error, "Rol kaydedilemedi.");
}
