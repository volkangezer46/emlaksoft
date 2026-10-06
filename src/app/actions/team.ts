"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { now } from "@/lib/clock";
import {
  HANDOFF_PERMISSION,
  HANDOFF_SCOPES,
  HANDOFF_SCOPE_LABELS,
  parseHandoffInput,
  type HandoffScope,
} from "@/lib/team/handoff";
import { PHONE_ERROR_MESSAGE } from "@/lib/phone";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { EMAIL_ERROR_MESSAGE, isValidEmail, normalizeEmail } from "@/lib/email";
import { planLimitErrorMessage } from "@/lib/billing/plan-limit-error";

import { ASSIGNABLE_ROLES, MANAGER_ROLES, canManageRole, type TeamRole } from "@/lib/team/assignable-roles";
import { syncScopeForRoleChange } from "@/lib/access-control/scope-sync";
import { ensureBranchBelongsToTenant, ensureSeatAvailable, provisionTeamMember } from "@/lib/team/provision-member";

export type TeamResult = { error?: string; ok?: boolean; id?: string };

type Role = TeamRole;

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
  const parsedPhone = phone ? parsePhoneStrict(phone) : null;
  if (parsedPhone && !parsedPhone.ok) return { error: parsedPhone.error ?? PHONE_ERROR_MESSAGE };
  if (password.length < 8) return { error: "Geçici şifre en az 8 karakter olmalı." };

  // Şube/koltuk doğrulaması + auth→profil atomik yazımı tek çekirdekte (kayıt sihirbazı da aynısını kullanır).
  const admin = createAdminClient();
  const created = await provisionTeamMember(admin, {
    tenantId,
    fullName,
    email,
    phone: parsedPhone?.stored ?? "",
    password,
    role,
    branchId,
  });
  if (!created.ok) return { error: created.error };

  revalidatePath("/app/ekip");
  return { ok: true, id: created.id };
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

  // Rol değişti: kapsam satırı rol varsayılanına çekilir (eski "office" kapsamı danışmanda kalmasın,
  // yeni takım lideri "user"da kilitlenmesin). Şema yoksa sessiz atlar; hatası ana akışı bozmaz.
  if (patch.role && patch.role !== target.role) {
    await syncScopeForRoleChange(admin, {
      tenantId,
      userId: id,
      newRole: patch.role as TeamRole,
      oldRole: String(target.role),
      actorId: user.id,
      branchId: ("branch_id" in patch ? (patch.branch_id as string | null) : target.branch_id) ?? null,
    });
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
  revalidatePath(`/app/ekip/${id}`);
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
  if (name.length > 120) return { error: "Şube adı en fazla 120 karakter olabilir." };

  const extra = await parseBranchExtras(supabase, tenantId, formData);
  if ("error" in extra) return { error: extra.error };

  const { error } = await supabase.from("branches").insert({
    tenant_id: tenantId,
    name,
    province_id: provinceId || null,
    ...extra.patch,
  });
  const planError = planLimitErrorMessage(error);
  if (planError) return { error: planError };
  if (error) return { error: "Şube oluşturulamadı." };

  revalidatePath("/app/ekip");
  revalidatePath("/app/ekip/subeler");
  return { ok: true };
}

/**
 * Şube müdürü (aynı ofisin aktif üyesi) ve telefon (yalnız alan formda varsa; `branches.phone`
 * şeması uygulanmadıysa form alanı hiç gönderilmez). Boş değer alanı temizler.
 */
async function parseBranchExtras(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  formData: FormData,
): Promise<{ patch: Record<string, unknown> } | { error: string }> {
  const patch: Record<string, unknown> = {};
  if (formData.has("manager_user_id")) {
    const managerId = String(formData.get("manager_user_id") ?? "").trim();
    if (managerId) {
      const { data: m } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", managerId)
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .maybeSingle();
      if (!m) return { error: "Şube müdürü bu ofisin aktif bir üyesi olmalı." };
      patch.manager_user_id = managerId;
    } else {
      patch.manager_user_id = null;
    }
  }
  if (formData.has("phone")) {
    const raw = String(formData.get("phone") ?? "").trim();
    if (raw) {
      const parsed = parsePhoneStrict(raw);
      if (!parsed.ok) return { error: parsed.error ?? PHONE_ERROR_MESSAGE };
      patch.phone = parsed.stored;
    } else {
      patch.phone = null;
    }
  }
  return { patch };
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
  const extra = await parseBranchExtras(supabase, tenantId, formData);
  if ("error" in extra) return { error: extra.error };
  Object.assign(patch, extra.patch);

  const { error } = await supabase.from("branches").update(patch).eq("id", id).eq("tenant_id", tenantId);
  const planError = planLimitErrorMessage(error);
  if (planError) return { error: planError };
  if (error) return { error: "Şube güncellenemedi." };

  revalidatePath("/app/ekip");
  revalidatePath("/app/ekip/subeler");
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
 * İş yükü devri — bir danışmanın (ör. ekipten ayrılan) seçilen iş kalemlerini başka bir danışmana aktarır:
 * müşteri, portföy, AÇIK anlaşma, açık görev, yaklaşan randevu (açık talepler müşteri sahipliğiyle taşınır;
 * `customer_demands`te ayrı sahip kolonu yoktur). Zorunlu gerekçe + seçili her kalem için düzenleme yetkisi.
 *
 * Atomik değil (RPC/migration yok) ama tutarlı: adımlar sırayla çalışır, biri hata verirse önceki adımlar
 * aynı kimlik kümesiyle geri çevrilir; geri çevirme de başarısız olursa kısmi durum açıkça raporlanır ve
 * denetim kaydına yazılır.
 */
export type HandoffResult = TeamResult & {
  counts?: Partial<Record<HandoffScope, number>>;
  /** Hata sonrası geri çevrilemeyen adımlar (varsa kısmi durum). */
  partial?: HandoffScope[];
  /** Seçili olup devredilecek kayıt bulunmayan (0 adet) kapsamlar. */
  skipped?: HandoffScope[];
};

export async function handoffMemberWorkload(formData: FormData): Promise<HandoffResult> {
  const gate = await requirePermission("team", "edit");
  if (!gate.ok) return { error: gate.error };

  const parsed = parseHandoffInput(formData);
  if (!parsed.ok) return { error: parsed.error };
  const { from, to, scopes, reason } = parsed.input;

  // Seçilen her kalem için o modülün düzenleme yetkisi (team:edit tek başına yetmez).
  for (const scope of scopes) {
    const perm = await requirePermission(HANDOFF_PERMISSION[scope], "edit");
    if (!perm.ok) return { error: `${HANDOFF_SCOPE_LABELS[scope]} devri için ilgili modülde düzenleme yetkisi gerekir.` };
  }

  const supabase = await createClient();

  // Devralan ve devreden aynı ofiste mi? (RLS zaten tenant'ı kısıtlar; yine de doğrula)
  const { data: people } = await supabase
    .from("profiles")
    .select("id, is_active, full_name, role")
    .in("id", [from, to])
    .eq("tenant_id", gate.tenantId);
  const target = (people ?? []).find((p) => p.id === to);
  const source = (people ?? []).find((p) => p.id === from);
  if (!target) return { error: "Devralan danışman bulunamadı." };
  if (!target.is_active) return { error: "Devralan danışman pasif — önce aktifleştirin." };
  if (!source) return { error: "Devreden danışman bu ofiste bulunamadı." };
  if (source.role === "owner" && gate.role !== "owner") {
    return { error: "Ofis sahibinin iş yükünü yalnız ofis sahibi devredebilir." };
  }

  const nowIso = new Date(now()).toISOString();
  const steps: Record<HandoffScope, () => PromiseLike<{ data: { id: string }[] | null; error: unknown }>> = {
    customers: () =>
      supabase
        .from("customers")
        .update({ assigned_to: to })
        .eq("tenant_id", gate.tenantId)
        .eq("assigned_to", from)
        .is("deleted_at", null)
        .select("id"),
    properties: () =>
      supabase
        .from("properties")
        .update({ assigned_to: to, updated_at: nowIso })
        .eq("tenant_id", gate.tenantId)
        .eq("assigned_to", from)
        .is("deleted_at", null)
        .select("id"),
    deals: () =>
      supabase
        .from("deals")
        .update({ assigned_to: to, updated_at: nowIso })
        .eq("tenant_id", gate.tenantId)
        .eq("assigned_to", from)
        .not("stage", "in", "(won,lost)")
        .select("id"),
    tasks: () =>
      supabase
        .from("tasks")
        .update({ assigned_to: to })
        .eq("tenant_id", gate.tenantId)
        .eq("assigned_to", from)
        .eq("status", "open")
        .select("id"),
    appointments: () =>
      supabase
        .from("appointments")
        .update({ assigned_to: to })
        .eq("tenant_id", gate.tenantId)
        .eq("assigned_to", from)
        .in("status", ["pending", "confirmed", "signature"])
        .gte("scheduled_at", nowIso)
        .select("id"),
  };
  const TABLE: Record<HandoffScope, string> = {
    customers: "customers",
    properties: "properties",
    deals: "deals",
    tasks: "tasks",
    appointments: "appointments",
  };

  const moved: Partial<Record<HandoffScope, string[]>> = {};
  let failedScope: HandoffScope | null = null;
  for (const scope of HANDOFF_SCOPES) {
    if (!scopes.includes(scope)) continue;
    const { data, error } = await steps[scope]();
    if (error) {
      console.error("handoffMemberWorkload", scope, error);
      failedScope = scope;
      break;
    }
    moved[scope] = (data ?? []).map((r) => r.id);
  }

  const counts: Partial<Record<HandoffScope, number>> = {};
  for (const scope of scopes) counts[scope] = moved[scope]?.length ?? 0;

  if (failedScope) {
    // Önceki adımları geri çevir (yalnız bu işlemde taşınan kimlikler, hâlâ devralana ait olanlar).
    const notReverted: HandoffScope[] = [];
    for (const scope of HANDOFF_SCOPES) {
      const ids = moved[scope];
      if (!ids?.length) continue;
      const { error } = await supabase
        .from(TABLE[scope])
        .update({ assigned_to: from })
        .eq("tenant_id", gate.tenantId)
        .eq("assigned_to", to)
        .in("id", ids);
      if (error) {
        console.error("handoffMemberWorkload revert", scope, error);
        notReverted.push(scope);
      }
    }
    await logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "team.handoff.failed",
      entityType: "profile",
      entityId: from,
      newValue: {
        to,
        to_name: target.full_name,
        reason,
        scopes,
        failed_scope: failedScope,
        not_reverted: notReverted,
        moved_counts: counts,
      },
    });
    revalidatePath("/app/musteriler");
    revalidatePath("/app/portfoyler");
    revalidatePath("/app/anlasmalar");
    revalidatePath(`/app/ekip/${from}`);
    revalidatePath(`/app/ekip/${to}`);
    return {
      error: notReverted.length
        ? `Devir ${HANDOFF_SCOPE_LABELS[failedScope]} adımında hata verdi ve ${notReverted.map((s) => HANDOFF_SCOPE_LABELS[s]).join(", ")} geri çevrilemedi; devir kısmen uygulanmış durumda. Denetim kaydına işlendi.`
        : `Devir ${HANDOFF_SCOPE_LABELS[failedScope]} adımında hata verdi; yapılan değişiklikler geri çevrildi, hiçbir kayıt devredilmedi.`,
      partial: notReverted,
      counts: {},
    };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "team.handoff",
    entityType: "profile",
    entityId: from,
    newValue: {
      to,
      to_name: target.full_name,
      reason,
      scopes,
      ...counts,
      moved_ids: Object.fromEntries(Object.entries(moved).map(([k, v]) => [k, (v ?? []).slice(0, 500)])),
    },
  });

  revalidatePath("/app/musteriler");
  revalidatePath("/app/portfoyler");
  revalidatePath("/app/anlasmalar");
  revalidatePath("/app/gorevler");
  revalidatePath("/app/randevular");
  revalidatePath(`/app/ekip/${from}`);
  revalidatePath(`/app/ekip/${to}`);
  const skipped = scopes.filter((sc) => !counts[sc]);
  return { ok: true, counts, skipped };
}

/**
 * Devir paneli için GERÇEK sayımlar (devir adımlarındaki süzgeçlerle aynı): müşteri, portföy, açık anlaşma,
 * açık görev, yaklaşan randevu. `team:view` yeter; satır sayısı taşımaz (head count).
 */
export async function getHandoffCounts(fromId: string): Promise<{ counts?: Record<HandoffScope, number>; error?: string }> {
  const gate = await requirePermission("team", "view");
  if (!gate.ok) return { error: gate.error };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fromId)) return { error: "Danışman kimliği geçersiz." };
  const supabase = await createClient();
  const nowIso = new Date(now()).toISOString();
  const head = { count: "exact", head: true } as const;
  const [c, p, d, t, a] = await Promise.all([
    supabase.from("customers").select("id", head).eq("tenant_id", gate.tenantId).eq("assigned_to", fromId).is("deleted_at", null),
    supabase.from("properties").select("id", head).eq("tenant_id", gate.tenantId).eq("assigned_to", fromId).is("deleted_at", null),
    supabase.from("deals").select("id", head).eq("tenant_id", gate.tenantId).eq("assigned_to", fromId).not("stage", "in", "(won,lost)"),
    supabase.from("tasks").select("id", head).eq("tenant_id", gate.tenantId).eq("assigned_to", fromId).eq("status", "open"),
    supabase
      .from("appointments")
      .select("id", head)
      .eq("tenant_id", gate.tenantId)
      .eq("assigned_to", fromId)
      .in("status", ["pending", "confirmed", "signature"])
      .gte("scheduled_at", nowIso),
  ]);
  if (c.error || p.error || d.error || t.error || a.error) return { error: "Sayımlar okunamadı." };
  return {
    counts: {
      customers: c.count ?? 0,
      properties: p.count ?? 0,
      deals: d.count ?? 0,
      tasks: t.count ?? 0,
      appointments: a.count ?? 0,
    },
  };
}
