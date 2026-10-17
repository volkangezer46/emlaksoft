"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  getPlatformStaffIdentity,
  requirePlatformModule,
} from "@/lib/platform";
import {
  IMPERSONATE_COOKIE,
  impersonationCookieOptions,
  restoreImpersonationMetadata,
} from "@/lib/impersonation";
import { logActivity } from "@/lib/activity";
import { logPlatformActivity } from "@/lib/platform-activity";
import { logError } from "@/lib/error-log";
import { parseImpersonationReason } from "@/lib/platform-security/impersonation-reason";
import { sensitiveFourEyesGate } from "@/lib/platform-security/four-eyes";
import { impersonationAllowedForStaff } from "@/lib/demo-tenant";
import { requireStepUp } from "@/lib/platform-security/step-up";
import { OFFICE_CLOSE_QUEUE_ONLY, officeCloseBlockedOutsideQueue } from "@/lib/platform-security/four-eyes";
import { OFFICE_CLOSE_STATUSES, statusChangeNeedsStepUp } from "@/lib/platform-security/step-up-policy";
import { applyTenantPlanStatus } from "@/lib/admin/tenant-plan-status";
import { getPlanDefinitions } from "@/lib/billing/plan-definitions";
import { isPlanId } from "@/lib/billing/plans";

export type PlatformResult = {
  error?: string;
  ok?: boolean;
  redirectTo?: string;
  code?: "stale" | "step_up_required" | "step_up_invalid" | "step_up_no_factor";
};

const STATUSES = ["trial", "active", "past_due", "suspended", "cancelled"] as const;
const IMPERSONATION_ROLES: ReadonlySet<string> = new Set(["super_admin", "ops", "support"]);

export async function updateTenantPlanStatus(formData: FormData): Promise<PlatformResult> {
  const staff = await requirePlatformModule("billing");

  const id = String(formData.get("id") ?? "").trim();
  const plan = String(formData.get("plan") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (!id) return { error: "Tenant bulunamadı." };
  if (status && !(STATUSES as readonly string[]).includes(status)) return { error: "Geçersiz durum." };
  if (!plan && !status) return { ok: true };

  const admin = createAdminClient();
  // Paket kataloğu (DG2): taban kimlikler + adminden eklenenler. Arşivli paket yalnız ofisin ZATEN o paketteyse geçer
  // (satır içi kaydetme paketi her zaman gönderir); son hakem `update_tenant_plan_subscription` (billing_plan_known).
  if (plan && !isPlanId(plan)) {
    const def = (await getPlanDefinitions().catch(() => [])).find((p) => p.id === plan);
    if (!def) return { error: "Geçersiz paket." };
    if (def.archived) {
      const { data: row } = await admin.from("tenants").select("plan").eq("id", id).maybeSingle();
      if (row?.plan !== plan) return { error: "Bu paket arşivlendi; yeni atama yapılamaz." };
    }
  }
  // İsteğe bağlı iyimser eşzamanlılık (satır içi kaydetme standardı): satır, okunduğu sürümden (`updated_at`)
  // sonra başkası tarafından değiştiyse yazmadan "bayat" döner. Alan gönderilmezse eski davranış aynen sürer.
  // AD11: askıya alma / iptal (ofis kapatma) YENİ geçişi doğrulayıcı kodu ister; mevcut durum bunun için okunur.
  const expectedUpdatedAt = String(formData.get("expected_updated_at") ?? "").trim();
  const closing = OFFICE_CLOSE_STATUSES.includes(status);
  if (expectedUpdatedAt || closing) {
    const { data: current, error: readError } = await admin.from("tenants").select("status, updated_at").eq("id", id).maybeSingle();
    if (readError || !current) return { error: "Tenant bulunamadı." };
    if (expectedUpdatedAt) {
      const currentMs = Date.parse(String(current.updated_at ?? ""));
      if (Number.isFinite(currentMs) && currentMs !== Date.parse(expectedUpdatedAt)) {
        return { error: "Bu satır başkası tarafından güncellendi. Yenileyip tekrar deneyin.", code: "stale" };
      }
    }
    if (statusChangeNeedsStepUp(status, String(current.status ?? ""))) {
      if (await officeCloseBlockedOutsideQueue()) return { error: OFFICE_CLOSE_QUEUE_ONLY };
      const stepUp = await requireStepUp(formData, "office_close", staff.id);
      if (!stepUp.ok) return { error: stepUp.error, code: stepUp.code };
    }
  }
  return applyTenantPlanStatus(admin, staff.id, { id, plan, status });
}

/**
 * Destek erişimi (ofise salt-okunur bürünme). AD11: gerekçe (≥10 karakter) ve bilet no ZORUNLU; eksikse oturum
 * açılmaz. Başlangıç ofisin kendi denetim günlüğüne "EmlakSoft destek erişimi" olarak (gerekçe + bilet no ile),
 * platform denetim izine (IP/UA) ve kalıcı geçmişe (platform_impersonation_history) yazılır.
 */
export async function startImpersonation(formData: FormData): Promise<void> {
  const staff = await requirePlatformModule("tenants");
  if (!IMPERSONATION_ROLES.has(staff.role)) return;
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  if (!tenantId) return;
  const justification = parseImpersonationReason(formData.get("reason"), formData.get("ticket_id"));
  if (!justification.ok) redirect(`/admin/tenants?destek=${justification.code}`);
  const { reason, ticketId } = justification;

  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, status, slug")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenant || tenant.status === "suspended" || tenant.status === "cancelled") return;
  // YD1: demo platform kişilikleri (herkese açık giriş kartları) yalnız demo ofise girebilir; gerçek ofise giriş reddedilir.
  if (!impersonationAllowedForStaff(staff.email, tenant.slug)) redirect("/admin/tenants?destek=demo");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== staff.id) return;

  const meta = (user.app_metadata ?? {}) as Record<string, unknown>;
  if (meta.impersonating === true) return;

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const sessionId = claimsData?.claims?.session_id;
  if (claimsError || typeof sessionId !== "string" || !sessionId) return;

  // Hassas işlem dört göz onayı (ayar açıksa): aynı ofis + aynı bilet için başka bir süper adminin onayı bir kez tüketilir.
  const fourEyes = await sensitiveFourEyesGate({
    kind: "impersonation",
    staffId: staff.id,
    entityType: "tenant",
    entityId: tenantId,
    binding: { tenant_id: tenantId, ticket_id: ticketId },
    summary: `Ofise destek erişimi: ${tenant.name} · bilet ${ticketId} · ${reason}`,
  });
  if (!fourEyes.proceed) redirect("queued" in fourEyes ? "/admin/tenants?destek=onay" : "/admin/tenants?destek=onay_hata");

  const claimExpiry = Number(claimsData.claims.exp);
  const nowIso = new Date().toISOString();
  const { error: staleCleanupError } = await admin
    .from("platform_impersonation_sessions")
    .delete()
    .eq("staff_id", staff.id)
    .lt("expires_at", nowIso);
  if (staleCleanupError) {
    console.error("start impersonation stale snapshot cleanup", staleCleanupError);
    return;
  }
  const expiresAt = new Date(
    Math.min(
      Date.now() + 4 * 60 * 60_000,
      Number.isFinite(claimExpiry) ? claimExpiry * 1000 : Number.MAX_SAFE_INTEGER,
    ),
  ).toISOString();
  const snapshotRow = {
    staff_id: staff.id,
    auth_session_id: sessionId,
    target_tenant_id: tenantId,
    original_app_metadata: meta,
    expires_at: expiresAt,
  };
  let { error: snapshotError } = await admin
    .from("platform_impersonation_sessions")
    .insert({ ...snapshotRow, reason, ticket_id: ticketId });
  if (snapshotError?.code === "PGRST204") {
    // AD11 migration'ı henüz yoksa (reason/ticket_id kolonu yok) eski biçimle yazılır; gerekçe denetim kayıtlarında kalır.
    ({ error: snapshotError } = await admin.from("platform_impersonation_sessions").insert(snapshotRow));
  }
  if (snapshotError) {
    console.error("start impersonation snapshot", snapshotError);
    return;
  }

  const impersonationMeta: Record<string, unknown> = {
    ...meta,
    tenant_id: tenantId,
    role: "readonly",
    impersonating: true,
    home_tenant_id: meta.tenant_id ?? null,
    home_role: meta.role ?? null,
    impersonation_session_id: sessionId,
  };
  const { error: claimError } = await admin.auth.admin.updateUserById(staff.id, {
    app_metadata: impersonationMeta,
  });
  if (claimError) {
    await admin.from("platform_impersonation_sessions").delete().eq("staff_id", staff.id);
    console.error("start impersonation claims", claimError);
    return;
  }

  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    const { error: compensationError } = await admin.auth.admin.updateUserById(staff.id, {
      app_metadata: restoreImpersonationMetadata(impersonationMeta, meta),
    });
    if (!compensationError) {
      await admin.from("platform_impersonation_sessions").delete().eq("staff_id", staff.id);
    }
    console.error("start impersonation refresh", { refreshError, compensationError });
    return;
  }

  const auditResult = await logActivity({
    tenantId,
    actorId: staff.id,
    action: "ops.impersonate.start",
    entityType: "tenant",
    entityId: tenantId,
    newValue: {
      erisim: "EmlakSoft destek erişimi (salt okunur)",
      tenant: tenant.name,
      reason,
      ticket_id: ticketId,
      expires_at: expiresAt,
      auth_session_id: sessionId,
      ...(fourEyes.approvalId ? { four_eyes_approval_id: fourEyes.approvalId } : {}),
    },
  });
  if (!auditResult.ok) {
    const { error: restoreError } = await admin.auth.admin.updateUserById(staff.id, {
      app_metadata: restoreImpersonationMetadata(impersonationMeta, meta),
    });
    if (!restoreError) {
      const [{ error: rollbackRefreshError }, { error: snapshotDeleteError }] = await Promise.all([
        supabase.auth.refreshSession(),
        admin
          .from("platform_impersonation_sessions")
          .delete()
          .eq("staff_id", staff.id)
          .eq("auth_session_id", sessionId),
      ]);
      if (rollbackRefreshError) await supabase.auth.signOut();
      console.error("start impersonation audit compensation", {
        audit: auditResult.error,
        rollbackRefreshError,
        snapshotDeleteError,
      });
    } else {
      // Keep the session snapshot so the fail-safe stop flow remains possible.
      console.error("start impersonation audit compensation", {
        audit: auditResult.error,
        restoreError,
      });
    }
    return;
  }

  const [{ error: historyError }] = await Promise.all([
    admin.from("platform_impersonation_history").insert({
      staff_id: staff.id,
      target_tenant_id: tenantId,
      auth_session_id: sessionId,
      reason,
      ticket_id: ticketId,
      expires_at: expiresAt,
    }),
    logPlatformActivity({
      actorId: staff.id,
      action: "ops.impersonate.start",
      entityType: "tenant",
      entityId: tenantId,
      meta: { tenant: tenant.name, reason, ticket_id: ticketId, expires_at: expiresAt, ...(fourEyes.approvalId ? { four_eyes_approval_id: fourEyes.approvalId } : {}) },
    }),
  ]);
  if (historyError && historyError.code !== "PGRST205") {
    // Geçmiş satırı yazılamadı: erişim ofis denetim günlüğünde zaten kayıtlı; hata görünür kalır.
    await logError({ source: "server", message: `Destek erişimi geçmişi yazılamadı: ${historyError.message}`, path: "platform_impersonation_history", userId: staff.id });
  }

  const jar = await cookies();
  jar.set(IMPERSONATE_COOKIE, tenantId, impersonationCookieOptions(true));
  jar.set("es_impersonate_name", tenant.name, impersonationCookieOptions(false));

  revalidatePath("/app");
  revalidatePath("/admin/tenants");
  redirect("/app");
}

export async function stopImpersonation(): Promise<void> {
  const staff = await getPlatformStaffIdentity();
  if (!staff) redirect("/giris");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== staff.id) return;

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const sessionId = claimsData?.claims?.session_id;
  if (claimsError || typeof sessionId !== "string" || !sessionId) return;

  const jar = await cookies();
  const admin = createAdminClient();
  const meta = (user.app_metadata ?? {}) as Record<string, unknown>;
  const { data: snapshot, error: snapshotError } = await admin
    .from("platform_impersonation_sessions")
    .select("auth_session_id, target_tenant_id, original_app_metadata")
    .eq("staff_id", staff.id)
    .maybeSingle();
  if (snapshotError) {
    console.error("stop impersonation snapshot", snapshotError);
    return;
  }

  let tenantId: string | null = null;
  let original: Record<string, unknown>;

  if (snapshot) {
    if (snapshot.auth_session_id !== sessionId) {
      console.error("stop impersonation session mismatch", { staffId: staff.id });
      return;
    }
    tenantId = snapshot.target_tenant_id;
    original = snapshot.original_app_metadata && typeof snapshot.original_app_metadata === "object"
      ? snapshot.original_app_metadata as Record<string, unknown>
      : {};
  } else if (meta.impersonating === true) {
    // Rolling-deploy compatibility for sessions started before snapshot table.
    tenantId = typeof meta.tenant_id === "string" ? meta.tenant_id : null;
    if (!tenantId) {
      console.error("stop impersonation legacy target missing", { staffId: staff.id });
      return;
    }
    original = { ...meta };
    original.tenant_id = meta.home_tenant_id ?? null;
    original.role = meta.home_role ?? null;
    delete original.home_tenant_id;
    delete original.home_role;
    delete original.impersonation_session_id;
    original.impersonating = false;
  } else {
    jar.delete(IMPERSONATE_COOKIE);
    jar.delete("es_impersonate_name");
    redirect("/admin/tenants");
  }

  const restored = restoreImpersonationMetadata(meta, original);
  const { error: restoreClaimError } = await admin.auth.admin.updateUserById(staff.id, {
    app_metadata: restored,
  });
  if (restoreClaimError) {
    console.error("stop impersonation claims", restoreClaimError);
    return;
  }

  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    // Snapshot/cookies intentionally stay in place so stop is retryable.
    console.error("stop impersonation refresh", refreshError);
    return;
  }

  let auditFailed = false;
  if (tenantId) {
    const auditResult = await logActivity({
      tenantId,
      actorId: staff.id,
      action: "ops.impersonate.stop",
      entityType: "tenant",
      entityId: tenantId,
    });
    auditFailed = !auditResult.ok;
  }

  if (tenantId) {
    // AD11 geçmiş: bitiş zamanı (tek kez) + platform denetim izi. Hata durdurmayı engellemez.
    const [{ error: endError }] = await Promise.all([
      admin
        .from("platform_impersonation_history")
        .update({ ended_at: new Date().toISOString(), end_kind: "stopped" })
        .eq("staff_id", staff.id)
        .eq("auth_session_id", sessionId)
        .is("ended_at", null),
      logPlatformActivity({ actorId: staff.id, action: "ops.impersonate.stop", entityType: "tenant", entityId: tenantId }),
    ]);
    if (endError && endError.code !== "PGRST205") console.error("stop impersonation history", endError.message);
  }

  if (snapshot) {
    const { error: deleteError } = await admin
      .from("platform_impersonation_sessions")
      .delete()
      .eq("staff_id", staff.id)
      .eq("auth_session_id", sessionId);
    if (deleteError) {
      console.error("stop impersonation snapshot cleanup", deleteError);
      return;
    }
  }

  jar.delete(IMPERSONATE_COOKIE);
  jar.delete("es_impersonate_name");

  revalidatePath("/app");
  revalidatePath("/admin/tenants");
  redirect(auditFailed ? "/admin/tenants?audit=failed" : "/admin/tenants");
}
