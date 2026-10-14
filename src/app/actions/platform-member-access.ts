"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { guardPlatformAction } from "@/lib/platform-guards";
import { logPlatformActivity } from "@/lib/platform-activity";
import { logActivity } from "@/lib/activity";
import { notifyTenant } from "@/lib/notify";
import { notifyAssignment, idsDigest } from "@/lib/assignment-notify";
import { now } from "@/lib/clock";
import { actionErrorMessage } from "@/lib/action-errors";
import { CLOSED_DEAL_STAGES, UNCLOSED_APPOINTMENT_STATUSES, postgrestInList } from "@/lib/workflow-state";
import { HANDOFF_SCOPES, HANDOFF_SCOPE_LABELS, parseHandoffInput, type HandoffScope } from "@/lib/team/handoff";
import { ACTION_ORDER, ALL_MODULES } from "@/lib/admin/member-access-explain";
import { canChangeScope, normalizeScopeInput, type ScopeInput } from "@/lib/access-control/admin-rules";
import { ASSIGNABLE_SCOPES } from "@/lib/access-control/scope-rules";
import type { AppAction, AppModule } from "@/lib/permissions";

/**
 * Admin > Üyeler destek araçları (AD6): SMS 2FA sıfırlama, etkin izin düzenleme (rol matrisi, kişi istisnası, kapsam),
 * pasifleştirmede iş yükü devri ve üye giriş günlüğü. Hepsi `members` platform modülü kapısından geçer; yazanlar
 * yalnız süper admin + operasyon. Her yazma hem platform denetimine (`platform_audit_logs`) hem ofisin kendi denetim
 * kaydına (`audit_logs`, aktör boş + `by: platform`) düşer; ofis yöneticisi değişikliği kendi ekranında görür.
 */

export type AccessActionResult = { ok?: boolean; error?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WRITERS = ["super_admin", "ops"] as const;
const RATE = { key: "platform-member-access", limit: 40, windowSec: 600 } as const;
const REASON_MIN = 5;
const REASON_MAX = 300;
/** Ofis rol matrisinde düzenlenebilen roller (owner daima tam yetkili; actions/permissions.ts ile aynı kural). */
const EDITABLE_ROLES = ["gm", "branch_manager", "team_lead", "advisor", "call_center", "accounting", "readonly"] as const;

type Admin = ReturnType<typeof createAdminClient>;
type Member = { id: string; tenant_id: string; role: string; full_name: string; is_active: boolean; two_factor_sms: boolean | null; branch_id: string | null };

async function loadMember(admin: Admin, id: string): Promise<Member | null> {
  if (!UUID_RE.test(id)) return null;
  const { data } = await admin
    .from("profiles")
    .select("id, tenant_id, role, full_name, is_active, two_factor_sms, branch_id")
    .eq("id", id)
    .maybeSingle();
  return (data as Member | null) ?? null;
}

function readReason(fd: FormData): string | { error: string } {
  const reason = String(fd.get("reason") ?? "").trim();
  if (reason.length < REASON_MIN) return { error: `Gerekçe zorunludur (en az ${REASON_MIN} karakter).` };
  if (reason.length > REASON_MAX) return { error: `Gerekçe en fazla ${REASON_MAX} karakter olabilir.` };
  return reason;
}

/** Ofis denetim kaydı: aktör platform personeli olduğu için actor_id boş, kim yaptığı `by` alanında. */
async function tenantAudit(input: {
  tenantId: string;
  action: string;
  entityType: string;
  entityId: string | null;
  staffId: string;
  oldValue?: Record<string, unknown> | null;
  newValue: Record<string, unknown>;
}) {
  await logActivity({
    tenantId: input.tenantId,
    actorId: null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    oldValue: input.oldValue ?? null,
    newValue: { ...input.newValue, by: "platform", platform_staff_id: input.staffId },
  });
}

function revalidateMember(id: string) {
  revalidatePath(`/admin/members/${id}`);
  revalidatePath("/admin/members");
}

// ---------------------------------------------------------------------------
// SMS 2FA sıfırlama (telefonu kaybeden danışman)
// ---------------------------------------------------------------------------

/**
 * Üyenin SMS 2FA'sını kapatır: `two_factor_sms=false` (tetikleyici `two_factor_version`'ı artırır → eski 2FA
 * çerezleri geçersiz), açık oturumlar ve bekleyen SMS doğrulamaları silinir. Üye parolasıyla girer ve 2FA'yı yeni
 * telefonuyla yeniden açar. Gerekçe zorunlu; platform + ofis denetimi ve üyeye uygulama içi bildirim düşer.
 */
export async function resetMemberTwoFactor(fd: FormData): Promise<AccessActionResult> {
  const gate = await guardPlatformAction({ module: "members", roles: WRITERS, rate: RATE });
  if ("error" in gate) return { error: gate.error };
  const reason = readReason(fd);
  if (typeof reason !== "string") return reason;

  const admin = createAdminClient();
  const member = await loadMember(admin, String(fd.get("id") ?? "").trim());
  if (!member) return { error: "Üye bulunamadı." };
  if (!member.two_factor_sms) return { error: "Bu üyenin SMS 2FA'sı zaten kapalı." };

  const { error } = await admin
    .from("profiles")
    .update({ two_factor_sms: false })
    .eq("id", member.id)
    .eq("tenant_id", member.tenant_id);
  if (error) return { error: actionErrorMessage(error, "2FA sıfırlanamadı.") };

  // Kayıp telefondaki açık oturum da kapanmalı (fonksiyon login_challenges + 2FA oturum kayıtlarını da siler).
  const { error: revokeError } = await admin.rpc("platform_revoke_user_sessions", { p_user_id: member.id });
  if (revokeError) console.error("resetMemberTwoFactor revoke", { id: member.id, error: revokeError.message });

  await Promise.all([
    logPlatformActivity({
      actorId: gate.staff.id,
      action: "platform_member.two_factor_reset",
      entityType: "profile",
      entityId: member.id,
      meta: { tenant_id: member.tenant_id, reason, sessions_revoked: !revokeError },
    }),
    tenantAudit({
      tenantId: member.tenant_id,
      action: "security.two_factor_reset",
      entityType: "profile",
      entityId: member.id,
      staffId: gate.staff.id,
      oldValue: { two_factor_sms: true },
      newValue: { two_factor_sms: false, reason, member_name: member.full_name },
    }),
  ]);

  if (member.is_active) {
    try {
      await notifyTenant({
        tenantId: member.tenant_id,
        userId: member.id,
        kind: "warning",
        title: "İki adımlı doğrulamanız sıfırlandı",
        body: "EmlakSoft destek ekibi talebiniz üzerine SMS doğrulamasını kapattı ve açık oturumlarınızı sonlandırdı. Hesabım > Güvenlik sekmesinden yeni telefonunuzla yeniden açın. Bu işlemi siz istemediyseniz hemen ofis yöneticinize ve desteğe bildirin.",
        href: "/app/hesabim?sekme=guvenlik",
      });
    } catch (e) {
      console.error("resetMemberTwoFactor notify", e);
    }
  }

  revalidateMember(member.id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Etkin izin düzenleme: ofis rol matrisi, kişi istisnası, kapsam
// ---------------------------------------------------------------------------

const isModule = (v: string): v is AppModule => (ALL_MODULES as readonly string[]).includes(v);
const isAction = (v: string): v is AppAction => (ACTION_ORDER as readonly string[]).includes(v);

/**
 * Ofisin rol matrisinde tek hücre: `mode` = allow | deny | default (satır silinir, rol varsayılanına döner).
 * Bu değişiklik o roldeki TÜM ofis üyelerini etkiler; arayüz bunu açıkça söyler.
 */
export async function setTenantRolePermissionAsStaff(fd: FormData): Promise<AccessActionResult> {
  const gate = await guardPlatformAction({ module: "members", roles: WRITERS, rate: RATE });
  if ("error" in gate) return { error: gate.error };
  const reason = readReason(fd);
  if (typeof reason !== "string") return reason;

  const tenantId = String(fd.get("tenant_id") ?? "").trim();
  const role = String(fd.get("role") ?? "").trim();
  const mod = String(fd.get("module") ?? "").trim();
  const action = String(fd.get("action") ?? "").trim();
  const mode = String(fd.get("mode") ?? "").trim();
  const memberId = String(fd.get("member_id") ?? "").trim();
  if (!UUID_RE.test(tenantId)) return { error: "Ofis kimliği geçersiz." };
  if (!(EDITABLE_ROLES as readonly string[]).includes(role)) return { error: "Bu rolün izinleri düzenlenemez (ofis sahibi daima tam yetkilidir)." };
  if (!isModule(mod) || !isAction(action)) return { error: "Modül veya işlem geçersiz." };
  if (mode !== "allow" && mode !== "deny" && mode !== "default") return { error: "Geçersiz seçim." };

  const admin = createAdminClient();
  const { data: tenant } = await admin.from("tenants").select("id").eq("id", tenantId).maybeSingle();
  if (!tenant) return { error: "Ofis bulunamadı." };

  const { data: before } = await admin
    .from("tenant_role_permissions")
    .select("allowed")
    .eq("tenant_id", tenantId)
    .eq("role", role)
    .eq("module", mod)
    .eq("action", action)
    .maybeSingle();

  const { error } =
    mode === "default"
      ? await admin.from("tenant_role_permissions").delete().eq("tenant_id", tenantId).eq("role", role).eq("module", mod).eq("action", action)
      : await admin.from("tenant_role_permissions").upsert(
          { tenant_id: tenantId, role, module: mod, action, allowed: mode === "allow", updated_by: null, updated_at: new Date(now()).toISOString() },
          { onConflict: "tenant_id,role,module,action" },
        );
  if (error) return { error: actionErrorMessage(error, "Rol izni güncellenemedi.") };

  const change = { role, module: mod, action, mode, reason };
  await Promise.all([
    logPlatformActivity({ actorId: gate.staff.id, action: "platform_member.role_permission", entityType: "tenant", entityId: tenantId, meta: { ...change, before: before?.allowed ?? null } }),
    tenantAudit({
      tenantId,
      action: "permission.role_update",
      entityType: "role_permission",
      entityId: null,
      staffId: gate.staff.id,
      oldValue: before ? { allowed: before.allowed } : null,
      newValue: { ...change, allowed: mode === "default" ? null : mode === "allow" },
    }),
  ]);
  if (UUID_RE.test(memberId)) revalidateMember(memberId);
  return { ok: true };
}

/**
 * Kişi istisnası: `mode=set` modülün aksiyon kümesini TAMAMEN `actions` yapar (boş = modül kapalı),
 * `mode=remove` satırı siler (rol iznine döner). Owner istisnadan muaftır; readonly tavanı istisna kabul etmez.
 */
export async function setMemberOverrideAsStaff(fd: FormData): Promise<AccessActionResult> {
  const gate = await guardPlatformAction({ module: "members", roles: WRITERS, rate: RATE });
  if ("error" in gate) return { error: gate.error };
  const reason = readReason(fd);
  if (typeof reason !== "string") return reason;

  const mod = String(fd.get("module") ?? "").trim();
  const mode = String(fd.get("mode") ?? "").trim();
  if (!isModule(mod)) return { error: "Modül geçersiz." };
  if (mode !== "set" && mode !== "remove") return { error: "Geçersiz seçim." };
  const actions = ACTION_ORDER.filter((a) => fd.getAll("actions").map(String).includes(a));
  // Görüntüleme olmadan yazma anlamsız: düzenleme/ekleme/silme seçilirse görüntüleme de eklenir.
  if (actions.length && !actions.includes("view")) actions.unshift("view");

  let expiresAt: string | null = null;
  const rawExpiry = String(fd.get("expires_at") ?? "").trim();
  if (rawExpiry) {
    const t = Date.parse(rawExpiry);
    if (Number.isNaN(t)) return { error: "Geçerli bir bitiş tarihi girin." };
    if (t <= now()) return { error: "Bitiş tarihi gelecekte olmalı." };
    expiresAt = new Date(t).toISOString();
  }

  const admin = createAdminClient();
  const member = await loadMember(admin, String(fd.get("id") ?? "").trim());
  if (!member) return { error: "Üye bulunamadı." };
  if (member.role === "owner") return { error: "Ofis sahibi istisnalardan muaftır (daima tam yetkili)." };
  if (member.role === "readonly") return { error: "Salt okunur rol sabit tavandır; istisna uygulanmaz." };

  const { data: before } = await admin
    .from("user_permission_overrides")
    .select("actions, expires_at")
    .eq("tenant_id", member.tenant_id)
    .eq("user_id", member.id)
    .eq("module", mod)
    .maybeSingle();

  const { error } =
    mode === "remove"
      ? await admin.from("user_permission_overrides").delete().eq("tenant_id", member.tenant_id).eq("user_id", member.id).eq("module", mod)
      : await admin.from("user_permission_overrides").upsert(
          {
            tenant_id: member.tenant_id,
            user_id: member.id,
            module: mod,
            actions,
            expires_at: expiresAt,
            created_by: null,
            created_at: new Date(now()).toISOString(),
          },
          { onConflict: "tenant_id,user_id,module" },
        );
  if (error) return { error: actionErrorMessage(error, "İstisna kaydedilemedi.") };

  const after = mode === "remove" ? null : { actions, expires_at: expiresAt };
  await Promise.all([
    logPlatformActivity({
      actorId: gate.staff.id,
      action: "platform_member.permission_override",
      entityType: "profile",
      entityId: member.id,
      meta: { tenant_id: member.tenant_id, module: mod, before: before ?? null, after, reason },
    }),
    tenantAudit({
      tenantId: member.tenant_id,
      action: mode === "remove" ? "permission.override_removed" : "permission.override_set",
      entityType: "profile",
      entityId: member.id,
      staffId: gate.staff.id,
      oldValue: before ? { module: mod, ...before } : null,
      newValue: { module: mod, after, reason, member_name: member.full_name },
    }),
  ]);
  revalidateMember(member.id);
  return { ok: true };
}

/**
 * Kapsam (user_scopes): `mode=reset` satırı siler (rol varsayılanına döner), `mode=set` yazar. Kurallar ofis
 * ekranıyla aynı (`canChangeScope`); platform personeli ofis sahibi yetkisiyle değerlendirilir (kendini düzenleme
 * kuralı uygulanmaz, owner/gm tabanı ve bayrak tutarlılığı aynen uygulanır).
 */
export async function setMemberScopeAsStaff(fd: FormData): Promise<AccessActionResult> {
  const gate = await guardPlatformAction({ module: "members", roles: WRITERS, rate: RATE });
  if ("error" in gate) return { error: gate.error };
  const reason = readReason(fd);
  if (typeof reason !== "string") return reason;
  const mode = String(fd.get("mode") ?? "").trim();
  if (mode !== "set" && mode !== "reset") return { error: "Geçersiz seçim." };

  const admin = createAdminClient();
  const member = await loadMember(admin, String(fd.get("id") ?? "").trim());
  if (!member) return { error: "Üye bulunamadı." };

  const COLS = "scope_type, team_id, branch_id, can_view_all_data, can_edit_team_members, can_override_permissions, can_see_earnings";
  const { data: before } = await admin.from("user_scopes").select(COLS).eq("tenant_id", member.tenant_id).eq("user_id", member.id).maybeSingle();

  let next: ScopeInput | null = null;
  if (mode === "set") {
    const scopeType = String(fd.get("scope_type") ?? "").trim();
    if (!(ASSIGNABLE_SCOPES as readonly string[]).includes(scopeType)) return { error: "Bu kapsam türü atanamaz." };
    const teamId = String(fd.get("team_id") ?? "").trim() || null;
    const branchId = String(fd.get("branch_id") ?? "").trim() || null;
    if ((teamId && !UUID_RE.test(teamId)) || (branchId && !UUID_RE.test(branchId))) return { error: "Takım/şube kimliği geçersiz." };
    next = normalizeScopeInput({
      scope_type: scopeType as ScopeInput["scope_type"],
      team_id: teamId,
      branch_id: branchId,
      can_view_all_data: fd.get("can_view_all_data") === "1",
      can_edit_team_members: fd.get("can_edit_team_members") === "1",
      can_override_permissions: fd.get("can_override_permissions") === "1",
      can_see_earnings: fd.get("can_see_earnings") === "1",
    });
    const rule = canChangeScope({ userId: `platform:${gate.staff.id}`, role: "owner" }, { userId: member.id, role: member.role }, next);
    if (!rule.ok) return { error: rule.reason };
    if (next.team_id) {
      const { data } = await admin.from("teams").select("id").eq("id", next.team_id).eq("tenant_id", member.tenant_id).eq("is_active", true).maybeSingle();
      if (!data) return { error: "Seçilen takım bu ofise ait aktif bir takım değil." };
    }
    if (next.branch_id) {
      const { data } = await admin.from("branches").select("id").eq("id", next.branch_id).eq("tenant_id", member.tenant_id).eq("is_active", true).maybeSingle();
      if (!data) return { error: "Seçilen şube bu ofise ait aktif bir şube değil." };
    }
  }

  const nowIso = new Date(now()).toISOString();
  const { error } = next
    ? await admin
        .from("user_scopes")
        .upsert({ tenant_id: member.tenant_id, user_id: member.id, ...next, created_by: null, updated_by: null, updated_at: nowIso }, { onConflict: "tenant_id,user_id" })
    : await admin.from("user_scopes").delete().eq("tenant_id", member.tenant_id).eq("user_id", member.id);
  if (error) return { error: actionErrorMessage(error, "Kapsam kaydedilemedi.") };

  await Promise.all([
    logPlatformActivity({
      actorId: gate.staff.id,
      action: "platform_member.scope",
      entityType: "profile",
      entityId: member.id,
      meta: { tenant_id: member.tenant_id, before: before ?? null, after: next, reason },
    }),
    tenantAudit({
      tenantId: member.tenant_id,
      action: next ? "access.scope_updated" : "access.scope_reset",
      entityType: "profile",
      entityId: member.id,
      staffId: gate.staff.id,
      oldValue: (before as Record<string, unknown> | null) ?? null,
      newValue: { after: next, reason, member_name: member.full_name },
    }),
  ]);
  revalidateMember(member.id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Pasifleştirmede iş yükü devri (ofis tarafı: actions/team.ts handoffMemberWorkload)
// ---------------------------------------------------------------------------

/**
 * Devir sihirbazı sayımları — ofis ekranındaki `getHandoffCounts` ile AYNI süzgeçler (müşteri, portföy, açık
 * anlaşma, açık görev, yaklaşan randevu) + devralabilecek aktif danışmanlar.
 */
export async function getMemberHandoffSnapshot(memberId: string): Promise<{
  counts?: Record<HandoffScope, number>;
  candidates?: { id: string; name: string; role: string }[];
  error?: string;
}> {
  const gate = await guardPlatformAction({ module: "members" });
  if ("error" in gate) return { error: gate.error };
  const admin = createAdminClient();
  const member = await loadMember(admin, memberId);
  if (!member) return { error: "Üye bulunamadı." };
  const counts = await countWorkload(admin, member.tenant_id, member.id);
  if ("error" in counts) return { error: counts.error };
  const { data: people } = await admin
    .from("profiles")
    .select("id, full_name, role")
    .eq("tenant_id", member.tenant_id)
    .eq("is_active", true)
    .neq("id", member.id)
    .neq("role", "readonly")
    .order("full_name", { ascending: true })
    .limit(200);
  return {
    counts: counts.counts,
    candidates: ((people ?? []) as { id: string; full_name: string; role: string }[]).map((p) => ({ id: p.id, name: p.full_name, role: p.role })),
  };
}

async function countWorkload(admin: Admin, tenantId: string, fromId: string): Promise<{ counts: Record<HandoffScope, number> } | { error: string }> {
  const nowIso = new Date(now()).toISOString();
  const head = { count: "exact", head: true } as const;
  const [c, p, d, t, a] = await Promise.all([
    admin.from("customers").select("id", head).eq("tenant_id", tenantId).eq("assigned_to", fromId).is("deleted_at", null),
    admin.from("properties").select("id", head).eq("tenant_id", tenantId).eq("assigned_to", fromId).is("deleted_at", null),
    admin.from("deals").select("id", head).eq("tenant_id", tenantId).eq("assigned_to", fromId).not("stage", "in", postgrestInList(CLOSED_DEAL_STAGES)),
    admin.from("tasks").select("id", head).eq("tenant_id", tenantId).eq("assigned_to", fromId).eq("status", "open"),
    admin
      .from("appointments")
      .select("id", head)
      .eq("tenant_id", tenantId)
      .eq("assigned_to", fromId)
      .in("status", [...UNCLOSED_APPOINTMENT_STATUSES])
      .gte("scheduled_at", nowIso),
  ]);
  if (c.error || p.error || d.error || t.error || a.error) return { error: actionErrorMessage(c.error ?? p.error ?? d.error ?? t.error ?? a.error, "Sayımlar okunamadı.") };
  return { counts: { customers: c.count ?? 0, properties: p.count ?? 0, deals: d.count ?? 0, tasks: t.count ?? 0, appointments: a.count ?? 0 } };
}

export type StaffHandoffResult = AccessActionResult & {
  counts?: Partial<Record<HandoffScope, number>>;
  remaining?: Record<HandoffScope, number>;
  partial?: HandoffScope[];
};

/**
 * Platform personeli adına iş yükü devri. Form sözleşmesi ofis ekranıyla aynıdır (`parseHandoffInput`: from, to,
 * reason, scope_<ad>); adımlar ve geri çevirme `handoffMemberWorkload` ile aynı süzgeçleri kullanır, yalnız istemci
 * service_role'dür (personel ofis oturumu taşımaz) ve her sorgu ofis kimliğiyle sınırlıdır. Devir sonrası kalan
 * sayımlar yeniden okunur (sihirbaz "0 kaldı" doğrulamasını gerçek veriden gösterir).
 */
export async function handoffMemberWorkloadAsStaff(fd: FormData): Promise<StaffHandoffResult> {
  const gate = await guardPlatformAction({ module: "members", roles: WRITERS, rate: RATE });
  if ("error" in gate) return { error: gate.error };
  const parsed = parseHandoffInput(fd);
  if (!parsed.ok) return { error: parsed.error };
  const { from, to, scopes, reason } = parsed.input;

  const admin = createAdminClient();
  const source = await loadMember(admin, from);
  if (!source) return { error: "Devreden danışman bulunamadı." };
  const tenantId = source.tenant_id;
  const { data: targetRow } = await admin.from("profiles").select("id, full_name, is_active, role").eq("id", to).eq("tenant_id", tenantId).maybeSingle();
  const target = targetRow as { id: string; full_name: string; is_active: boolean; role: string } | null;
  if (!target) return { error: "Devralan danışman bu ofiste bulunamadı." };
  if (!target.is_active) return { error: "Devralan danışman pasif — önce aktifleştirin." };
  if (target.role === "readonly") return { error: "Salt okunur kullanıcıya iş yükü devredilemez." };

  const nowIso = new Date(now()).toISOString();
  const steps: Record<HandoffScope, () => PromiseLike<{ data: { id: string }[] | null; error: unknown }>> = {
    customers: () => admin.from("customers").update({ assigned_to: to }).eq("tenant_id", tenantId).eq("assigned_to", from).is("deleted_at", null).select("id"),
    properties: () =>
      admin.from("properties").update({ assigned_to: to, updated_at: nowIso }).eq("tenant_id", tenantId).eq("assigned_to", from).is("deleted_at", null).select("id"),
    deals: () =>
      admin
        .from("deals")
        .update({ assigned_to: to, updated_at: nowIso })
        .eq("tenant_id", tenantId)
        .eq("assigned_to", from)
        .not("stage", "in", postgrestInList(CLOSED_DEAL_STAGES))
        .select("id"),
    tasks: () => admin.from("tasks").update({ assigned_to: to }).eq("tenant_id", tenantId).eq("assigned_to", from).eq("status", "open").select("id"),
    appointments: () =>
      admin
        .from("appointments")
        .update({ assigned_to: to })
        .eq("tenant_id", tenantId)
        .eq("assigned_to", from)
        .in("status", [...UNCLOSED_APPOINTMENT_STATUSES])
        .gte("scheduled_at", nowIso)
        .select("id"),
  };

  const moved: Partial<Record<HandoffScope, string[]>> = {};
  let failedScope: HandoffScope | null = null;
  for (const scope of HANDOFF_SCOPES) {
    if (!scopes.includes(scope)) continue;
    const { data, error } = await steps[scope]();
    if (error) {
      console.error("handoffMemberWorkloadAsStaff", scope, error);
      failedScope = scope;
      break;
    }
    moved[scope] = (data ?? []).map((r) => r.id);
  }
  const counts: Partial<Record<HandoffScope, number>> = {};
  for (const scope of scopes) counts[scope] = moved[scope]?.length ?? 0;

  if (failedScope) {
    const notReverted: HandoffScope[] = [];
    for (const scope of HANDOFF_SCOPES) {
      const ids = moved[scope];
      if (!ids?.length) continue;
      const { error } = await admin.from(scope).update({ assigned_to: from }).eq("tenant_id", tenantId).eq("assigned_to", to).in("id", ids);
      if (error) notReverted.push(scope);
    }
    await Promise.all([
      logPlatformActivity({
        actorId: gate.staff.id,
        action: "platform_member.handoff_failed",
        entityType: "profile",
        entityId: from,
        meta: { tenant_id: tenantId, to, reason, scopes, failed_scope: failedScope, not_reverted: notReverted, moved_counts: counts },
      }),
      tenantAudit({
        tenantId,
        action: "team.handoff.failed",
        entityType: "profile",
        entityId: from,
        staffId: gate.staff.id,
        newValue: { to, to_name: target.full_name, reason, scopes, failed_scope: failedScope, not_reverted: notReverted, moved_counts: counts },
      }),
    ]);
    return {
      error: notReverted.length
        ? `Devir ${HANDOFF_SCOPE_LABELS[failedScope]} adımında hata verdi ve ${notReverted.map((s) => HANDOFF_SCOPE_LABELS[s]).join(", ")} geri çevrilemedi; devir kısmen uygulanmış durumda. Denetim kaydına işlendi.`
        : `Devir ${HANDOFF_SCOPE_LABELS[failedScope]} adımında hata verdi; yapılan değişiklikler geri çevrildi, hiçbir kayıt devredilmedi.`,
      partial: notReverted,
    };
  }

  await Promise.all([
    logPlatformActivity({
      actorId: gate.staff.id,
      action: "platform_member.handoff",
      entityType: "profile",
      entityId: from,
      meta: { tenant_id: tenantId, to, reason, scopes, ...counts },
    }),
    tenantAudit({
      tenantId,
      action: "team.handoff",
      entityType: "profile",
      entityId: from,
      staffId: gate.staff.id,
      newValue: {
        to,
        to_name: target.full_name,
        reason,
        scopes,
        ...counts,
        moved_ids: Object.fromEntries(Object.entries(moved).map(([k, v]) => [k, (v ?? []).slice(0, 500)])),
      },
    }),
  ]);

  const movedParts = HANDOFF_SCOPES.filter((sc) => (counts[sc] ?? 0) > 0).map((sc) => `${counts[sc]} ${HANDOFF_SCOPE_LABELS[sc].toLocaleLowerCase("tr-TR")}`);
  if (movedParts.length > 0) {
    await notifyAssignment({
      tenantId,
      userId: to,
      title: `İş yükü devri: ${source.full_name ?? "Bir danışman"} → size`,
      body: `Size devredildi: ${movedParts.join(", ")}. Gerekçe: ${reason.slice(0, 160)}`,
      href: `/app/ekip/${to}`,
      dedupeKey: `team-handoff:${from}:${to}:${idsDigest(HANDOFF_SCOPES.flatMap((sc) => moved[sc] ?? []))}`,
    });
  }

  const remaining = await countWorkload(admin, tenantId, from);
  revalidateMember(from);
  return { ok: true, counts, ...("counts" in remaining ? { remaining: remaining.counts } : {}) };
}

// ---------------------------------------------------------------------------
// Ofis 360 > Ekip: üye bazında giriş günlüğü (tıklayınca yüklenir)
// ---------------------------------------------------------------------------

export type LoginLogRow = { id: string; created_at: string; result: string; ip: string | null; user_agent: string | null };

export async function getMemberLoginLog(memberId: string): Promise<{ rows?: LoginLogRow[]; error?: string }> {
  const gate = await guardPlatformAction({ module: "members" });
  if ("error" in gate) return { error: gate.error };
  if (!UUID_RE.test(memberId)) return { error: "Üye kimliği geçersiz." };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("login_events")
    .select("id, created_at, result, ip, user_agent")
    .eq("user_id", memberId)
    .order("created_at", { ascending: false })
    .limit(15);
  if (error) return { error: actionErrorMessage(error, "Giriş kayıtları okunamadı.") };
  return { rows: (data ?? []) as LoginLogRow[] };
}
