"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { isValidOptionalTurkishMobile, normalizeTurkishPhone, TR_MOBILE_ERROR_MESSAGE } from "@/lib/phone";

export type TeamResult = { error?: string; ok?: boolean };

const ROLES = [
  "owner",
  "gm",
  "branch_manager",
  "team_lead",
  "advisor",
  "call_center",
  "accounting",
  "readonly",
] as const;

type Role = (typeof ROLES)[number];

// Roles allowed to manage the team
const MANAGER_ROLES: Role[] = ["owner", "gm", "branch_manager"];
// Roles a manager can assign (owner cannot be created/assigned through this flow)
const ASSIGNABLE_ROLES: Role[] = ["gm", "branch_manager", "team_lead", "advisor", "call_center", "accounting", "readonly"];

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
  const { tenantId } = ctx;

  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "advisor").trim() as Role;
  const branchId = String(formData.get("branch_id") ?? "").trim();

  if (!fullName || !email) return { error: "Ad ve e-posta zorunlu." };
  if (!isValidOptionalTurkishMobile(phone)) return { error: TR_MOBILE_ERROR_MESSAGE };
  if (!ASSIGNABLE_ROLES.includes(role)) return { error: "Geçerli bir rol seçin." };
  if (password.length < 8) return { error: "Geçici şifre en az 8 karakter olmalı." };

  const normalizedPhone = phone ? normalizeTurkishPhone(phone) : "";
  const admin = createAdminClient();

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
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: "Profil oluşturulamadı." };
  }

  revalidatePath("/app/ekip");
  return { ok: true };
}

export async function updateTeamMember(formData: FormData): Promise<TeamResult> {
  const ctx = await requireManager();
  if ("error" in ctx) return { error: ctx.error };
  const { tenantId, user } = ctx;

  const id = String(formData.get("id") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim() as Role;
  const branchId = String(formData.get("branch_id") ?? "").trim();
  const activeRaw = String(formData.get("is_active") ?? "").trim();

  if (!id) return { error: "Üye bulunamadı." };
  if (id === user.id && role && role !== "owner") {
    // avoid locking yourself out of management by downgrading own role here
  }

  const admin = createAdminClient();

  // ensure the target belongs to the same tenant
  const { data: target } = await admin
    .from("profiles")
    .select("id, tenant_id, role")
    .eq("id", id)
    .maybeSingle();
  if (!target || target.tenant_id !== tenantId) return { error: "Üye bu ofise ait değil." };
  if (target.role === "owner") return { error: "Ofis sahibi bu ekrandan düzenlenemez." };

  const patch: Record<string, unknown> = {};
  if (role) {
    if (!ASSIGNABLE_ROLES.includes(role)) return { error: "Geçerli bir rol seçin." };
    patch.role = role;
  }
  if (formData.has("branch_id")) patch.branch_id = branchId || null;
  if (activeRaw) patch.is_active = activeRaw === "true";

  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await admin.from("profiles").update(patch).eq("id", id);
  if (error) return { error: "Üye güncellenemedi." };

  // keep auth claims in sync with role changes
  if (patch.role) {
    await admin.auth.admin.updateUserById(id, {
      app_metadata: { tenant_id: tenantId, role: patch.role },
    });
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
