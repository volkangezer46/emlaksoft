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
import { planLimitErrorMessage } from "@/lib/billing/plan-limit-error";
import { actionErrorMessage } from "@/lib/action-errors";

export type PlatformResult = { error?: string; ok?: boolean; redirectTo?: string };

const PLANS = ["advisor", "office", "professional", "business", "enterprise"] as const;
const STATUSES = ["trial", "active", "past_due", "suspended", "cancelled"] as const;
const IMPERSONATION_ROLES: ReadonlySet<string> = new Set(["super_admin", "ops", "support"]);

export async function updateTenantPlanStatus(formData: FormData): Promise<PlatformResult> {
  const staff = await requirePlatformModule("billing");

  const id = String(formData.get("id") ?? "").trim();
  const plan = String(formData.get("plan") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (!id) return { error: "Tenant bulunamadı." };
  if (plan && !(PLANS as readonly string[]).includes(plan)) return { error: "Geçersiz paket." };
  if (status && !(STATUSES as readonly string[]).includes(status)) return { error: "Geçersiz durum." };
  if (!plan && !status) return { ok: true };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("update_tenant_plan_subscription", {
    p_tenant_id: id,
    p_actor_id: staff.id,
    p_plan: plan || null,
    p_status: status || null,
  });
  if (error) {
    console.error("updateTenantPlanStatus", error);
    return {
      error:
        planLimitErrorMessage(error) ??
        (error.code === "PGRST202"
          ? "Abonelik güncelleme servisi henüz hazır değil. Veritabanı migration'ını uygulayın."
          : actionErrorMessage(null, "Tenant ve abonelik güncellenemedi.")),
    };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/tenants");
  revalidatePath("/admin/billing");
  revalidatePath("/vitrin/[slug]", "page");
  revalidatePath("/vitrin/[slug]/[id]", "page");
  revalidatePath("/vitrin/[slug]/degerleme", "page");
  revalidatePath("/vitrin/[slug]/favoriler", "page");
  revalidatePath("/danisman/[slug]", "page");
  revalidatePath("/sitemap.xml");
  const tenantSlug = data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>).tenantSlug
    : null;
  if (typeof tenantSlug === "string" && tenantSlug) {
    revalidatePath(`/vitrin/${tenantSlug}`);
  }
  return { ok: true };
}

export async function startImpersonation(formData: FormData): Promise<void> {
  const staff = await requirePlatformModule("tenants");
  if (!IMPERSONATION_ROLES.has(staff.role)) return;
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  if (!tenantId) return;

  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, status")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenant || tenant.status === "suspended" || tenant.status === "cancelled") return;

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
  const { error: snapshotError } = await admin
    .from("platform_impersonation_sessions")
    .insert({
      staff_id: staff.id,
      auth_session_id: sessionId,
      target_tenant_id: tenantId,
      original_app_metadata: meta,
      expires_at: expiresAt,
    });
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
    newValue: { tenant: tenant.name, auth_session_id: sessionId },
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
