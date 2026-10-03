"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { parsePhone, PHONE_ERROR_MESSAGE } from "@/lib/phone";
import { EMAIL_ERROR_MESSAGE, isValidEmail, normalizeEmail } from "@/lib/email";
import { getPlan } from "@/lib/billing/plans";
import { planLimitErrorMessage } from "@/lib/billing/plan-limit-error";

import { ASSIGNABLE_ROLES, MANAGER_ROLES, canManageRole, type TeamRole } from "@/lib/team/assignable-roles";

export type TeamResult = { error?: string; ok?: boolean; id?: string };

type Role = TeamRole;

async function ensureBranchBelongsToTenant(
  admin: ReturnType<typeof createAdminClient>,
  branchId: string,
  tenantId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!branchId) return { ok: true };
  const { data: branch, error } = await admin
    .from("branches")
    .select("id")
    .eq("id", branchId)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !branch) {
    return { ok: false, error: "Seçilen şube bu ofise ait değil veya aktif değil." };
  }
  return { ok: true };
}

async function ensureSeatAvailable(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [{ data: tenant, error: tenantError }, { count, error: countError }] =
    await Promise.all([
      admin.from("tenants").select("plan, status").eq("id", tenantId).maybeSingle(),
      admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("is_active", true),
    ]);
  if (tenantError || countError || !tenant) {
    return { ok: false, error: "Paket ve ekip kapasitesi doğrulanamadı." };
  }
  if (tenant.status === "suspended" || tenant.status === "cancelled") {
    return { ok: false, error: "Askıdaki veya iptal edilmiş ofise üye eklenemez." };
  }

  const limit = getPlan(String(tenant.plan)).limits.seats;
  if ((count ?? 0) >= limit) {
    return {
      ok: false,
      error: `Paketiniz en fazla ${limit} aktif kullanıcı destekliyor. Paketi yükseltin veya bir üyeyi pasife alın.`,
    };
  }
  return { ok: true };
}

async function requireManager() {
  const gate = await requirePermission("team", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Oturum bulunamadı." as const };
  const role = (user.app_metadata?.role as Role | undefined) ?? "advisor";
  if (!MANAGER_ROLES.includes(role)) return { error: "Bu işlem için yetkiniz yok." as const };
  return { supabase, tenantId: gate.tenantId, user, role };
}

export async function createTeamMember(_prev: TeamResult, formData: FormData): Promise<TeamResult> {
  const ctx = await requireManager();
  if ("error" in ctx) return { error: ctx.error };
  const { tenantId, role: actorRole } = ctx;

  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const phone = String(formData.get("phone") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "advisor").trim() as Role;
  const branchId = String(formData.get("branch_id") ?? "").trim();

  if (!ASSIGNABLE_ROLES.includes(role) || !canManageRole(actorRole, role)) {
    return { error: "Bu rolü atama yetkiniz yok." };
  }

  if (!fullName || !email) return { error: "Ad ve e-posta zorunlu." };
  if (!isValidEmail(email)) return { error: EMAIL_ERROR_MESSAGE };
  const parsedPhone = phone ? parsePhone(phone) : null;
  if (parsedPhone && !parsedPhone.ok) return { error: parsedPhone.error ?? PHONE_ERROR_MESSAGE };
  if (!ASSIGNABLE_ROLES.includes(role)) return { error: "Geçerli bir rol seçin." };
  if (password.length < 8) return { error: "Geçici şifre en az 8 karakter olmalı." };

  const normalizedPhone = parsedPhone?.stored ?? "";
  const admin = createAdminClient();
  const branch = await ensureBranchBelongsToTenant(admin, branchId, tenantId);
  if (!branch.ok) return { error: branch.error };
  const seat = await ensureSeatAvailable(admin, tenantId);
  if (!seat.ok) return { error: seat.error };

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone: normalizedPhone },
    app_metadata: { tenant_id: tenantId, role },
  });

  if (createError || !created.user) {
    return {
      error: createError?.message?.includes("already")
        ? "Bu e-posta zaten kayıtlı."
        : "Kullanıcı oluşturulamadı.",
    };
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    tenant_id: tenantId,
    full_name: fullName,
    phone: normalizedPhone || null,
    role,
    branch_id: branchId || null,
  });

  if (profileError) {
    const planError = planLimitErrorMessage(profileError);
    await admin.auth.admin.deleteUser(created.user.id);
    if (planError) return { error: planError };
    return { error: "Profil oluşturulamadı." };
  }

  revalidatePath("/app/ekip");
  return { ok: true, id: created.user.id };
}

export async function updateTeamMember(formData: FormData): Promise<TeamResult> {
  const ctx = await requireManager();
  if ("error" in ctx) return { error: ctx.error };
  const { tenantId, user, role: actorRole } = ctx;

  const id = String(formData.get("id") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim() as Role;
  const branchId = String(formData.get("branch_id") ?? "").trim();
  const activeRaw = String(formData.get("is_active") ?? "").trim();

  if (!id) return { error: "Üye bulunamadı." };
  // Kendini yönetimden kilitleme koruması: kendi rolünü bu ekrandan değiştiremez / kendini pasife alamaz
  if (id === user.id && role && role !== "owner" && role !== "gm") {
    return { error: "Kendi yönetici rolünüzü bu ekrandan düşüremezsiniz." };
  }
  if (id === user.id && activeRaw === "false") {
    return { error: "Kendinizi pasife alamazsınız." };
  }

  const admin = createAdminClient();

  // ensure the target belongs to the same tenant
  const { data: target } = await admin
    .from("profiles")
    .select("id, tenant_id, role, branch_id, is_active")
    .eq("id", id)
    .maybeSingle();
  if (!target || target.tenant_id !== tenantId) return { error: "Üye bu ofise ait değil." };
  if (target.role === "owner") return { error: "Ofis sahibi bu ekrandan düzenlenemez." };

  if (!canManageRole(actorRole, target.role as Role)) {
    return { error: "Bu üyeyi yönetme yetkiniz yok." };
  }
  if (role && (!ASSIGNABLE_ROLES.includes(role) || !canManageRole(actorRole, role))) {
    return { error: "Bu rolü atama yetkiniz yok." };
  }
  if (formData.has("branch_id")) {
    const branch = await ensureBranchBelongsToTenant(admin, branchId, tenantId);
    if (!branch.ok) return { error: branch.error };
  }

  if (activeRaw === "true" && !target.is_active) {
    const seat = await ensureSeatAvailable(admin, tenantId);
    if (!seat.ok) return { error: seat.error };
  }

  const patch: Record<string, unknown> = {};
  if (role) {
    if (!ASSIGNABLE_ROLES.includes(role)) return { error: "Geçerli bir rol seçin." };
    patch.role = role;
  }
  if (formData.has("branch_id")) patch.branch_id = branchId || null;
  if (activeRaw) patch.is_active = activeRaw === "true";

  if (Object.keys(patch).length === 0) return { ok: true };

  const requiresIdentitySync = Boolean(patch.role) || "is_active" in patch;
  const { data: authRecord, error: authReadError } = requiresIdentitySync
    ? await admin.auth.admin.getUserById(id)
    : { data: { user: null }, error: null };
  if (requiresIdentitySync && (authReadError || !authRecord.user)) {
    console.error("team identity read", authReadError);
    return { error: "Üyenin kimlik kaydı doğrulanamadı." };
  }

  const { error } = await admin.from("profiles").update(patch).eq("id", id);
  const planError = planLimitErrorMessage(error);
  if (planError) return { error: planError };
  if (error) return { error: "Üye güncellenemedi." };

  // Claims, ban state and canonical profile move as one compensated operation.
  if (requiresIdentitySync) {
    const currentMeta = (authRecord.user!.app_metadata ?? {}) as Record<string, unknown>;
    const includesActive = "is_active" in patch;
    const nextActive = includesActive ? patch.is_active === true : target.is_active;
    const { error: claimError } = await admin.auth.admin.updateUserById(id, {
      app_metadata: {
        ...currentMeta,
        tenant_id: tenantId,
        role: patch.role ?? target.role,
        account_active: nextActive,
        deactivated_at: nextActive ? null : new Date().toISOString(),
      },
      ...(includesActive
        ? { ban_duration: nextActive ? ("none" as const) : "876000h" }
        : {}),
    });
    if (claimError) {
      const rollback: Record<string, unknown> = { role: target.role };
      if ("branch_id" in patch) rollback.branch_id = target.branch_id;
      if ("is_active" in patch) rollback.is_active = target.is_active;
      const { error: rollbackError } = await admin.from("profiles").update(rollback).eq("id", id);
      if (rollbackError) {
        console.error("team role claim rollback", {
          claim: claimError.message,
          rollback: rollbackError.message,
          profileId: id,
        });
      }
      return { error: "Rol kimliği güncellenemedi; değişiklik geri alındı." };
    }
  }

  if ("is_active" in patch && patch.is_active === false) {
    const { error: revokeError } = await admin.rpc("revoke_team_member_sessions", {
      p_user_id: id,
      p_tenant_id: tenantId,
    });
    if (revokeError) {
      // Fail secure: profile is inactive and Auth user is banned even if a
      // rolling migration delays physical session cleanup.
      console.error("team session revoke", { profileId: id, error: revokeError.message });
      return { error: "Üye pasife alındı; açık oturum temizliği tekrar denenmeli." };
    }
  }

  revalidatePath("/app/ekip");
  return { ok: true };
}

// void wrappers for direct <form action> usage in server components
export async function setMemberActive(formData: FormData): Promise<void> {
  await updateTeamMember(formData);
}

export async function setMemberRole(formData: FormData): Promise<void> {
  await updateTeamMember(formData);
}

export async function createBranch(_prev: TeamResult, formData: FormData): Promise<TeamResult> {
  const ctx = await requireManager();
  if ("error" in ctx) return { error: ctx.error };
  const { supabase, tenantId } = ctx;

  const name = String(formData.get("name") ?? "").trim();
  const provinceId = String(formData.get("province_id") ?? "").trim();
  if (!name) return { error: "Şube adı zorunlu." };

  const { error } = await supabase.from("branches").insert({
    tenant_id: tenantId,
    name,
    province_id: provinceId || null,
  });
  const planError = planLimitErrorMessage(error);
  if (planError) return { error: planError };
  if (error) return { error: "Şube oluşturulamadı." };

  revalidatePath("/app/ekip");
  return { ok: true };
}

export async function updateBranch(formData: FormData): Promise<TeamResult> {
  const ctx = await requireManager();
  if ("error" in ctx) return { error: ctx.error };
  const { supabase, tenantId } = ctx;

  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const provinceId = String(formData.get("province_id") ?? "").trim();
  if (!id) return { error: "Şube bulunamadı." };
  if (!name) return { error: "Şube adı zorunlu." };

  const patch: Record<string, unknown> = { name };
  if (formData.has("province_id")) patch.province_id = provinceId || null;
  if (formData.has("is_active")) patch.is_active = String(formData.get("is_active")) === "true";

  const { error } = await supabase.from("branches").update(patch).eq("id", id).eq("tenant_id", tenantId);
  const planError = planLimitErrorMessage(error);
  if (planError) return { error: planError };
  if (error) return { error: "Şube güncellenemedi." };

  revalidatePath("/app/ekip");
  return { ok: true };
}

export async function deleteBranch(formData: FormData): Promise<TeamResult> {
  const ctx = await requireManager();
  if ("error" in ctx) return { error: ctx.error };
  const { supabase, tenantId } = ctx;

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Şube bulunamadı." };

  const { count } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("branch_id", id);
  if ((count ?? 0) > 0) {
    return { error: `Bu şubeye bağlı ${count} üye var; önce onları başka şubeye taşıyın.` };
  }

  const { error } = await supabase.from("branches").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return { error: "Şube silinemedi (portföy/müşteri bağlı olabilir)." };

  revalidatePath("/app/ekip");
  return { ok: true };
}

export async function setBranchAction(formData: FormData): Promise<void> {
  await updateBranch(formData);
}

export async function deleteBranchAction(formData: FormData): Promise<void> {
  await deleteBranch(formData);
}

/**
 * İş yükü devri — bir danışmanın (ör. ekipten ayrılan) TÜM aktif müşteri VE
 * portföylerini başka bir danışmana tek işlemde aktarır. Önceden yalnız müşteri
 * toplu ataması vardı (bulkAssignCustomers); portföy devri hiç yoktu → ayrılan
 * kişinin portföyleri sahipsiz kalıyordu. İki toplu update + tek denetim kaydı.
 */
export async function handoffMemberWorkload(formData: FormData): Promise<TeamResult> {
  const gate = await requirePermission("team", "edit");
  if (!gate.ok) return { error: gate.error };

  const from = String(formData.get("from") ?? "").trim();
  const to = String(formData.get("to") ?? "").trim();
  if (!from || !to) return { error: "Devreden ve devralan danışman seçilmelidir." };
  if (from === to) return { error: "İş yükü aynı danışmana devredilemez." };

  const supabase = await createClient();

  // Devralan aynı ofiste ve aktif mi? (RLS zaten tenant'ı kısıtlar; yine de doğrula)
  const { data: target } = await supabase
    .from("profiles")
    .select("id, is_active, full_name")
    .eq("id", to)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!target) return { error: "Devralan danışman bulunamadı." };
  if (!target.is_active) return { error: "Devralan danışman pasif — önce aktifleştirin." };

  const [{ error: cErr, count: cCount }, { error: pErr, count: pCount }] = await Promise.all([
    supabase
      .from("customers")
      .update({ assigned_to: to }, { count: "exact" })
      .eq("tenant_id", gate.tenantId)
      .eq("assigned_to", from)
      .is("deleted_at", null),
    supabase
      .from("properties")
      .update({ assigned_to: to, updated_at: new Date().toISOString() }, { count: "exact" })
      .eq("tenant_id", gate.tenantId)
      .eq("assigned_to", from)
      .is("deleted_at", null),
  ]);
  if (cErr || pErr) {
    console.error("handoffMemberWorkload", cErr ?? pErr);
    return { error: "Devir sırasında hata oluştu." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "team.handoff",
    entityType: "profile",
    entityId: from,
    newValue: { to, to_name: target.full_name, customers: cCount ?? 0, properties: pCount ?? 0 },
  });

  revalidatePath("/app/musteriler");
  revalidatePath("/app/portfoyler");
  revalidatePath(`/app/ekip/${from}`);
  revalidatePath(`/app/ekip/${to}`);
  return { ok: true };
}
