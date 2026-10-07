"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { MANAGER_ROLES, type TeamRole } from "@/lib/team/assignable-roles";
import { parseTeamInput } from "@/lib/team/team-input";
import { actionErrorMessage } from "@/lib/action-errors";

export type TeamsResult = { error?: string; ok?: boolean };

async function gate() {
  const g = await requirePermission("team", "edit");
  if (!g.ok) return { error: g.error } as const;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Oturum bulunamadı." } as const;
  const role = (user.app_metadata?.role as TeamRole | undefined) ?? "advisor";
  if (!MANAGER_ROLES.includes(role)) return { error: "Bu işlem için yetkiniz yok." } as const;
  return { supabase, tenantId: g.tenantId } as const;
}

type Ctx = { supabase: Awaited<ReturnType<typeof createClient>>; tenantId: string };

/** Şube ve lider aynı ofisin kaydı olmalı (FK tek başına başka ofis kimliğini engellemez). */
async function checkRefs(ctx: Ctx, branchId: string | null, leadUserId: string | null): Promise<string | null> {
  if (branchId) {
    const { data } = await ctx.supabase.from("branches").select("id").eq("id", branchId).eq("tenant_id", ctx.tenantId).eq("is_active", true).maybeSingle();
    if (!data) return "Şube bu ofise ait aktif bir şube olmalı.";
  }
  if (leadUserId) {
    const { data } = await ctx.supabase.from("profiles").select("id").eq("id", leadUserId).eq("tenant_id", ctx.tenantId).eq("is_active", true).maybeSingle();
    if (!data) return "Takım lideri bu ofisin aktif bir üyesi olmalı.";
  }
  return null;
}

function done(): TeamsResult {
  revalidatePath("/app/ekip/takimlar");
  revalidatePath("/app/ekip");
  return { ok: true };
}

export async function createTeam(_prev: TeamsResult, formData: FormData): Promise<TeamsResult> {
  const ctx = await gate();
  if ("error" in ctx) return { error: ctx.error };
  const parsed = parseTeamInput(formData);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.value;
  const refErr = await checkRefs(ctx, v.branchId, v.leadUserId);
  if (refErr) return { error: refErr };
  const { error } = await ctx.supabase.from("teams").insert({ tenant_id: ctx.tenantId, name: v.name, branch_id: v.branchId, lead_user_id: v.leadUserId });
  if (error) return { error: error.code === "23505" ? "Bu adla bir takım zaten var." : "Takım oluşturulamadı (takım şeması uygulanmamış olabilir)." };
  return done();
}

export async function updateTeam(formData: FormData): Promise<TeamsResult> {
  const ctx = await gate();
  if ("error" in ctx) return { error: ctx.error };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Takım bulunamadı." };
  const parsed = parseTeamInput(formData);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.value;
  const refErr = await checkRefs(ctx, v.branchId, v.leadUserId);
  if (refErr) return { error: refErr };
  const patch: Record<string, unknown> = { name: v.name, branch_id: v.branchId, lead_user_id: v.leadUserId };
  if (v.isActive !== null) patch.is_active = v.isActive;
  const { error } = await ctx.supabase.from("teams").update(patch).eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) return { error: error.code === "23505" ? "Bu adla bir takım zaten var." : actionErrorMessage(error, "Takım güncellenemedi.") };
  return done();
}

export async function deleteTeam(formData: FormData): Promise<TeamsResult> {
  const ctx = await gate();
  if ("error" in ctx) return { error: ctx.error };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Takım bulunamadı." };
  const { count } = await ctx.supabase.from("profiles").select("id", { count: "exact", head: true }).eq("team_id", id).eq("tenant_id", ctx.tenantId);
  if ((count ?? 0) > 0) return { error: `Bu takımda ${count} üye var; önce üyeleri başka takıma taşıyın.` };
  const { error } = await ctx.supabase.from("teams").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) return { error: actionErrorMessage(error, "Takım silinemedi.") };
  return done();
}

/** Üyenin takımını değiştirir (boş = takımsız). Tetikleyici ofis ve yetki tutarlılığını ayrıca doğrular. */
export async function setMemberTeam(formData: FormData): Promise<TeamsResult> {
  const ctx = await gate();
  if ("error" in ctx) return { error: ctx.error };
  const memberId = String(formData.get("member_id") ?? "").trim();
  const teamId = String(formData.get("team_id") ?? "").trim();
  if (!memberId) return { error: "Üye bulunamadı." };
  if (teamId) {
    const { data } = await ctx.supabase.from("teams").select("id").eq("id", teamId).eq("tenant_id", ctx.tenantId).eq("is_active", true).maybeSingle();
    if (!data) return { error: "Takım bulunamadı veya pasif." };
  }
  const { error } = await ctx.supabase.from("profiles").update({ team_id: teamId || null }).eq("id", memberId).eq("tenant_id", ctx.tenantId);
  if (error) return { error: actionErrorMessage(error, "Üyenin takımı güncellenemedi.") };
  return done();
}
