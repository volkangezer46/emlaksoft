"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { isPlanId, type PlanId } from "@/lib/billing/plans";
import { requirePlatformModule } from "@/lib/platform";
import { notifyPlatformStaff } from "@/lib/platform-notify";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBaseUrl } from "@/lib/base-url";

export type SalesResult = { ok?: boolean; error?: string };

export type ConvertResult = {
  ok?: boolean;
  error?: string;
  tenantId?: string;
  tenantName?: string;
  slug?: string;
  email?: string;
  accessLinkSent?: boolean;
};

const STATUSES = ["new", "contacted", "qualified", "won", "lost"] as const;

function slugify(input: string) {
  return input
    .toLocaleLowerCase("tr-TR")
    .replace(/\u011f/g, "g")
    .replace(/\u00fc/g, "u")
    .replace(/\u015f/g, "s")
    .replace(/\u0131/g, "i")
    .replace(/\u00f6/g, "o")
    .replace(/\u00e7/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function generatePassword(): string {
  const groups = [
    "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "abcdefghijkmnopqrstuvwxyz",
    "23456789",
    "!@#_-",
  ] as const;
  const all = groups.join("");
  const chars = groups.map((group) => group[randomInt(group.length)]!);

  while (chars.length < 18) chars.push(all[randomInt(all.length)]!);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

async function sendOwnerAccessLink(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
): Promise<boolean> {
  const { error } = await admin.auth.resetPasswordForEmail(email, {
    redirectTo: `${getBaseUrl()}/sifre-yenile`,
  });
  if (error) {
    console.error("sendOwnerAccessLink", { code: error.code, status: error.status });
    return false;
  }
  return true;
}

type ConversionSnapshot = {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  plan: PlanId;
  email: string;
  ownerUserId: string;
};

type ConversionRecovery =
  | { state: "committed"; snapshot: ConversionSnapshot }
  | { state: "not_committed" }
  | { state: "unknown" };

function parseConversionSnapshot(
  value: unknown,
  expectedOwnerUserId: string,
  expectedEmail: string,
): ConversionSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const tenantId = typeof record.tenantId === "string" ? record.tenantId : "";
  const tenantName = typeof record.tenantName === "string" ? record.tenantName.trim() : "";
  const tenantSlug = typeof record.tenantSlug === "string" ? record.tenantSlug.trim() : "";
  const email = typeof record.email === "string" ? record.email.trim().toLowerCase() : "";
  const ownerUserId = typeof record.ownerUserId === "string" ? record.ownerUserId : "";
  const plan = typeof record.plan === "string" ? record.plan : "";

  if (
    !tenantId
    || !tenantName
    || !tenantSlug
    || !isPlanId(plan)
    || email !== expectedEmail
    || ownerUserId !== expectedOwnerUserId
  ) {
    return null;
  }

  return { tenantId, tenantName, tenantSlug, plan, email, ownerUserId };
}

async function recoverCommittedConversion(
  admin: ReturnType<typeof createAdminClient>,
  demoId: string,
  ownerUserId: string,
  email: string,
): Promise<ConversionRecovery> {
  const [demoResult, profileResult] = await Promise.all([
    admin
      .from("demo_requests")
      .select("converted_tenant_id")
      .eq("id", demoId)
      .maybeSingle(),
    admin
      .from("profiles")
      .select("tenant_id")
      .eq("id", ownerUserId)
      .maybeSingle(),
  ]);

  if (demoResult.error || profileResult.error) return { state: "unknown" };

  const tenantId = demoResult.data?.converted_tenant_id;
  const ownerTenantId = profileResult.data?.tenant_id;
  if (!ownerTenantId) return { state: "not_committed" };
  if (typeof tenantId !== "string" || ownerTenantId !== tenantId) return { state: "unknown" };

  const [tenantResult, subscriptionResult] = await Promise.all([
    admin
      .from("tenants")
      .select("id, name, slug, plan")
      .eq("id", tenantId)
      .maybeSingle(),
    admin
      .from("subscriptions")
      .select("tenant_id")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  const tenant = tenantResult.data;
  if (tenantResult.error || subscriptionResult.error) return { state: "unknown" };
  if (
    !tenant
    || subscriptionResult.data?.tenant_id !== tenantId
    || typeof tenant.name !== "string"
    || typeof tenant.slug !== "string"
    || typeof tenant.plan !== "string"
    || !isPlanId(tenant.plan)
  ) {
    return { state: "unknown" };
  }

  return {
    state: "committed",
    snapshot: {
      tenantId,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      plan: tenant.plan,
      email,
      ownerUserId,
    },
  };
}

export async function setDemoStatus(formData: FormData): Promise<SalesResult> {
  const staff = await requirePlatformModule("sales");
  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (!id) return { error: "Kay\u0131t bulunamad\u0131." };
  if (!(STATUSES as readonly string[]).includes(status)) return { error: "Ge\u00e7ersiz durum." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("demo_requests")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("setDemoStatus", error);
    return { error: "Durum g\u00fcncellenemedi." };
  }

  await admin.from("audit_logs").insert({
    tenant_id: null,
    actor_id: staff.id,
    action: "sales.status",
    entity_type: "demo",
    entity_id: id,
    new_value: { status },
  });

  revalidatePath("/admin/satis");
  revalidatePath("/admin");
  return { ok: true };
}

export async function assignDemo(formData: FormData): Promise<SalesResult> {
  const staff = await requirePlatformModule("sales");
  const id = String(formData.get("id") ?? "").trim();
  const assignee = String(formData.get("assigned_to") ?? "").trim();
  if (!id) return { error: "Kay\u0131t bulunamad\u0131." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("demo_requests")
    .update({ assigned_to: assignee || null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("assignDemo", error);
    return { error: "Atama yap\u0131lamad\u0131." };
  }

  await admin.from("audit_logs").insert({
    tenant_id: null,
    actor_id: staff.id,
    action: "sales.assign",
    entity_type: "demo",
    entity_id: id,
    new_value: { assigned_to: assignee || null },
  });

  revalidatePath("/admin/satis");
  return { ok: true };
}

export async function addDemoNote(formData: FormData): Promise<SalesResult> {
  const staff = await requirePlatformModule("sales");
  const id = String(formData.get("id") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  if (!id || !note) return { error: "Not bo\u015f olamaz." };

  const admin = createAdminClient();
  const { data: current } = await admin.from("demo_requests").select("notes").eq("id", id).maybeSingle();
  const stamp = new Date().toLocaleString("tr-TR", {
    timeZone: "Europe/Istanbul",
    dateStyle: "short",
    timeStyle: "short",
  });
  const line = `[${stamp} \u2022 ${staff.full_name}] ${note}`;
  const merged = current?.notes ? `${current.notes}\n${line}` : line;

  const { error } = await admin
    .from("demo_requests")
    .update({ notes: merged, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("addDemoNote", error);
    return { error: "Not eklenemedi." };
  }

  revalidatePath("/admin/satis");
  return { ok: true };
}

/**
 * Converts a won lead to a tenant. Auth is created first; the tenant, owner
 * profile, subscription, demo state and audit evidence are one RPC transaction.
 */
export async function convertDemoToTenant(formData: FormData): Promise<ConvertResult> {
  const staff = await requirePlatformModule("sales");
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Kay\u0131t bulunamad\u0131." };

  const admin = createAdminClient();
  const { data: demo, error: demoError } = await admin
    .from("demo_requests")
    .select("id, full_name, phone, email, company, converted_tenant_id")
    .eq("id", id)
    .maybeSingle();

  if (demoError) {
    console.error("convertDemoToTenant:demo", demoError);
    return { error: "Lead bilgileri al\u0131namad\u0131." };
  }
  if (!demo) return { error: "Lead bulunamad\u0131." };
  if (demo.converted_tenant_id) return { error: "Bu lead zaten bir ofise d\u00f6n\u00fc\u015ft\u00fcr\u00fclm\u00fc\u015f." };

  const fullName = (demo.full_name ?? "").trim();
  const phone = (demo.phone ?? "").trim();
  const email = (demo.email ?? "").trim().toLowerCase();
  if (!email) return { error: "D\u00f6n\u00fc\u015ft\u00fcrmek i\u00e7in \u00f6nce lead'e e-posta ekleyin." };

  const companyName = (demo.company ?? "").trim() || `${fullName} Emlak`;
  const baseSlug = slugify(companyName) || "ofis";
  const tempPassword = generatePassword();

  // Auth is intentionally created first. The RPC validates this exact pending
  // identity and the profile insert trigger synchronizes tenant claims.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone },
    app_metadata: { role: "owner", account_active: true },
  });

  if (createError || !created.user) {
    console.error("convertDemoToTenant:user", createError);
    return {
      error: createError?.message?.toLowerCase().includes("already")
        ? "Bu e-posta zaten kay\u0131tl\u0131; muhtemelen m\u00fc\u015fteri hesab\u0131 daha \u00f6nce olu\u015fturulmu\u015f."
        : "Kullan\u0131c\u0131 olu\u015fturulamad\u0131.",
    };
  }

  const ownerUserId = created.user.id;
  const { data: provisioned, error: provisionError } = await admin.rpc(
    "convert_demo_request_to_tenant",
    {
      p_demo_id: id,
      p_owner_user_id: ownerUserId,
      p_actor_id: staff.id,
      p_slug_base: baseSlug,
    },
  );

  let conversion = provisionError
    ? null
    : parseConversionSnapshot(provisioned, ownerUserId, email);

  if (!conversion) {
    // A transport failure can occur after the database committed. Confirm the
    // linked demo/profile/subscription before deciding whether deletion is safe.
    const recovery = await recoverCommittedConversion(admin, id, ownerUserId, email);
    if (recovery.state === "committed") {
      conversion = recovery.snapshot;
      console.warn("convertDemoToTenant:recovered-committed-rpc", {
        demoId: id,
        ownerUserId,
        rpcCode: provisionError?.code,
      });
    } else if (recovery.state === "not_committed") {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(ownerUserId);
      if (cleanupError) {
        console.error("convertDemoToTenant:auth-cleanup", {
          demoId: id,
          ownerUserId,
          cleanupError,
        });
      }
    } else {
      // Commit state is ambiguous; deleting could cascade an already committed
      // owner profile. Preserve the account for operational reconciliation.
      console.error("convertDemoToTenant:ambiguous-rpc-state", {
        demoId: id,
        ownerUserId,
        provisionError,
      });
    }

    if (!conversion) {
      console.error("convertDemoToTenant:provision", provisionError ?? "Invalid RPC response");
      return { error: "Ofis d\u00f6n\u00fc\u015f\u00fcm\u00fc tamamlanamad\u0131. L\u00fctfen tekrar deneyin." };
    }
  }

  await notifyPlatformStaff({
    title: "Lead ofise d\u00f6n\u00fc\u015ft\u00fcr\u00fcld\u00fc",
    body: `${conversion.tenantName} \u2022 ${conversion.plan} \u2022 14 g\u00fcn deneme ba\u015flad\u0131`,
    href: `/admin/tenants/${conversion.tenantId}`,
    kind: "success",
    meta: { tenant_id: conversion.tenantId, demo_id: id },
  });

  revalidatePath("/admin/satis");
  revalidatePath("/admin/tenants");
  revalidatePath("/admin");

  // The random bootstrap password is deliberately never returned or shown to
  // platform staff. The owner sets a private password through a one-time
  // recovery link delivered directly to the verified email address.
  const accessLinkSent = await sendOwnerAccessLink(admin, conversion.email);

  return {
    ok: true,
    tenantId: conversion.tenantId,
    tenantName: conversion.tenantName,
    slug: conversion.tenantSlug,
    email: conversion.email,
    accessLinkSent,
  };
}

export async function resendConvertedOwnerAccessLink(formData: FormData): Promise<SalesResult> {
  await requirePlatformModule("sales");
  const demoId = String(formData.get("id") ?? "").trim();
  if (!demoId) return { error: "Lead bulunamadı." };

  const admin = createAdminClient();
  const { data: demo, error: demoError } = await admin
    .from("demo_requests")
    .select("converted_tenant_id")
    .eq("id", demoId)
    .maybeSingle();
  if (demoError || !demo?.converted_tenant_id) {
    return { error: "Dönüştürülmüş ofis bulunamadı." };
  }

  const { data: owner, error: ownerError } = await admin
    .from("profiles")
    .select("id")
    .eq("tenant_id", demo.converted_tenant_id)
    .eq("role", "owner")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (ownerError || !owner) return { error: "Aktif ofis sahibi bulunamadı." };

  const { data: authUser, error: authError } = await admin.auth.admin.getUserById(owner.id);
  const email = authUser.user?.email?.trim().toLowerCase();
  if (authError || !email) return { error: "Ofis sahibi e-postası bulunamadı." };

  if (!(await sendOwnerAccessLink(admin, email))) {
    return { error: "Güvenli erişim e-postası gönderilemedi. E-posta sağlayıcısını kontrol edin." };
  }
  return { ok: true };
}
