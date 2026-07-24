"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformStaff, requirePlatformModule } from "@/lib/platform";
import { IMPERSONATE_COOKIE } from "@/lib/impersonation";
import { logActivity } from "@/lib/activity";
import { getPlan, type PlanId } from "@/lib/billing/plans";

export type PlatformResult = { error?: string; ok?: boolean; redirectTo?: string };

const PLANS = ["advisor", "office", "professional", "enterprise"] as const;
const STATUSES = ["trial", "active", "past_due", "suspended", "cancelled"] as const;

export async function updateTenantPlanStatus(formData: FormData): Promise<PlatformResult> {
  await requirePlatformStaff();

  const id = String(formData.get("id") ?? "").trim();
  const plan = String(formData.get("plan") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();

  if (!id) return { error: "Tenant bulunamadı." };
  if (plan && !(PLANS as readonly string[]).includes(plan)) return { error: "Geçersiz paket." };
  if (status && !(STATUSES as readonly string[]).includes(status)) return { error: "Geçersiz durum." };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (plan) patch.plan = plan;
  if (status) patch.status = status;

  const admin = createAdminClient();
  const { error } = await admin.from("tenants").update(patch).eq("id", id);
  if (error) {
    console.error("updateTenantPlanStatus", error);
    return { error: "Tenant güncellenemedi." };
  }

  const subPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (plan) {
    subPatch.plan = plan;
    subPatch.amount_try = getPlan(plan as PlanId).monthlyTry;
  }
  if (status) {
    subPatch.status =
      status === "trial"
        ? "trialing"
        : status === "active"
          ? "active"
          : status === "past_due"
            ? "past_due"
            : status === "cancelled"
              ? "cancelled"
              : "paused";
  }
  const { error: subError } = await admin.from("subscriptions").update(subPatch).eq("tenant_id", id);
  if (subError) console.error("updateTenantPlanStatus subscription", subError);

  revalidatePath("/admin");
  revalidatePath("/admin/tenants");
  revalidatePath("/admin/billing");
  return { ok: true };
}

export async function setTenantPlanStatus(formData: FormData): Promise<void> {
  await updateTenantPlanStatus(formData);
}

/**
 * Gerçek impersonation: JWT app_metadata.tenant_id + profiles.tenant_id geçici değişir.
 * Rol readonly — yanlışlıkla yıkıcı yazmayı azaltır. Cookie banner için.
 */
export async function startImpersonation(formData: FormData): Promise<void> {
  // Impersonation tenant yönetimi yetkisi gerektirir (destek/muhasebe rolü giremez)
  const staff = await requirePlatformModule("tenants");
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  if (!tenantId) return;

  const admin = createAdminClient();
  const { data: tenant } = await admin.from("tenants").select("id, name").eq("id", tenantId).maybeSingle();
  if (!tenant) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const meta = (user.app_metadata ?? {}) as Record<string, unknown>;
  const homeTenant =
    (meta.home_tenant_id as string | undefined) ??
    (meta.tenant_id as string | undefined) ??
    null;
  const homeRole = (meta.home_role as string | undefined) ?? (meta.role as string | undefined) ?? "owner";

  const { data: profile } = await admin.from("profiles").select("tenant_id, role").eq("id", staff.id).maybeSingle();

  await admin.auth.admin.updateUserById(staff.id, {
    app_metadata: {
      ...meta,
      tenant_id: tenantId,
      role: "readonly",
      impersonating: true,
      home_tenant_id: homeTenant ?? profile?.tenant_id ?? null,
      home_role: homeRole ?? profile?.role ?? "owner",
    },
  });

  if (profile) {
    await admin
      .from("profiles")
      .update({
        tenant_id: tenantId,
        role: "readonly",
        updated_at: new Date().toISOString(),
      })
      .eq("id", staff.id);
  }

  const jar = await cookies();
  jar.set(IMPERSONATE_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 4,
  });
  jar.set("es_impersonate_name", tenant.name, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 4,
  });

  await logActivity({
    tenantId,
    actorId: staff.id,
    action: "ops.impersonate.start",
    entityType: "tenant",
    entityId: tenantId,
    newValue: { tenant: tenant.name },
  });

  await supabase.auth.refreshSession();

  revalidatePath("/app");
  revalidatePath("/admin/tenants");
  redirect("/app");
}

export async function stopImpersonation(): Promise<void> {
  const staff = await requirePlatformStaff();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const jar = await cookies();
  const tenantId = jar.get(IMPERSONATE_COOKIE)?.value;
  jar.delete(IMPERSONATE_COOKIE);
  jar.delete("es_impersonate_name");

  const admin = createAdminClient();
  const meta = (user?.app_metadata ?? {}) as Record<string, unknown>;
  const homeTenant = (meta.home_tenant_id as string | undefined) ?? null;
  const homeRole = (meta.home_role as string | undefined) ?? "owner";

  if (user && homeTenant) {
    await admin.auth.admin.updateUserById(staff.id, {
      app_metadata: {
        ...meta,
        tenant_id: homeTenant,
        role: homeRole,
        impersonating: false,
        home_tenant_id: homeTenant,
        home_role: homeRole,
      },
    });
    await admin
      .from("profiles")
      .update({
        tenant_id: homeTenant,
        role: homeRole,
        updated_at: new Date().toISOString(),
      })
      .eq("id", staff.id);
    await supabase.auth.refreshSession();
  }

  if (tenantId) {
    await logActivity({
      tenantId,
      actorId: staff.id,
      action: "ops.impersonate.stop",
      entityType: "tenant",
      entityId: tenantId,
    });
  }

  revalidatePath("/app");
  revalidatePath("/admin/tenants");
  redirect("/admin/tenants");
}
