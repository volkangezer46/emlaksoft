"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { notifyPlatformStaff } from "@/lib/platform-notify";

export type SalesResult = { ok?: boolean; error?: string };

export type ConvertResult = {
  ok?: boolean;
  error?: string;
  tenantId?: string;
  tenantName?: string;
  slug?: string;
  email?: string;
  tempPassword?: string;
};

const STATUSES = ["new", "contacted", "qualified", "won", "lost"] as const;

function slugify(input: string) {
  return input
    .toLocaleLowerCase("tr-TR")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function planFromTeamSize(size: string | null): "advisor" | "office" | "professional" | "enterprise" {
  const s = (size ?? "").trim();
  if (s === "1") return "advisor";
  if (s === "50+" || s === "50plus") return "enterprise";
  if (s === "10-50" || s === "11-50") return "professional";
  return "office";
}

const PLAN_PRICES: Record<string, number> = {
  advisor: 990,
  office: 2490,
  professional: 5990,
  enterprise: 12900,
};

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return `Emlak-${out}`;
}

export async function setDemoStatus(formData: FormData): Promise<SalesResult> {
  const staff = await requirePlatformModule("sales");
  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (!id) return { error: "Kayıt bulunamadı." };
  if (!(STATUSES as readonly string[]).includes(status)) return { error: "Geçersiz durum." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("demo_requests")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("setDemoStatus", error);
    return { error: "Durum güncellenemedi." };
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
  if (!id) return { error: "Kayıt bulunamadı." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("demo_requests")
    .update({ assigned_to: assignee || null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("assignDemo", error);
    return { error: "Atama yapılamadı." };
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
  if (!id || !note) return { error: "Not boş olamaz." };

  const admin = createAdminClient();
  const { data: current } = await admin.from("demo_requests").select("notes").eq("id", id).maybeSingle();
  const stamp = new Date().toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short", timeStyle: "short" });
  const line = `[${stamp} · ${staff.full_name}] ${note}`;
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
 * Kazanılan lead'i tek tıkla ofise (tenant) dönüştürür:
 * tenant + owner kullanıcı + 14 gün trial abonelik oluşturur, lead'i "won" olarak işaretler.
 * Geçici şifreyi geri döner (satış ekibi müşteriyle paylaşır).
 */
export async function convertDemoToTenant(formData: FormData): Promise<ConvertResult> {
  const staff = await requirePlatformModule("sales");
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Kayıt bulunamadı." };

  const admin = createAdminClient();
  const { data: demo } = await admin
    .from("demo_requests")
    .select("id, full_name, phone, email, company, team_size, converted_tenant_id")
    .eq("id", id)
    .maybeSingle();

  if (!demo) return { error: "Lead bulunamadı." };
  if (demo.converted_tenant_id) return { error: "Bu lead zaten bir ofise dönüştürülmüş." };

  const email = (demo.email ?? "").trim().toLowerCase();
  if (!email) return { error: "Dönüştürmek için önce lead'e e-posta ekleyin." };

  const companyName = (demo.company ?? "").trim() || `${demo.full_name} Emlak`;
  const phone = (demo.phone ?? "").trim();

  const baseSlug = slugify(companyName) || "ofis";
  let slug = baseSlug;
  for (let i = 0; i < 6; i++) {
    const { data: existing } = await admin.from("tenants").select("id").eq("slug", slug).maybeSingle();
    if (!existing) break;
    slug = `${baseSlug}-${Math.floor(100 + Math.random() * 900)}`;
  }

  const plan = planFromTeamSize(demo.team_size);
  const trialEnds = new Date();
  trialEnds.setDate(trialEnds.getDate() + 14);

  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .insert({
      name: companyName,
      slug,
      plan,
      status: "trial",
      trial_ends_at: trialEnds.toISOString(),
    })
    .select("id")
    .single();

  if (tenantError || !tenant) {
    console.error("convertDemoToTenant:tenant", tenantError);
    return { error: "Ofis oluşturulamadı." };
  }

  const tempPassword = generatePassword();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: demo.full_name, phone },
    app_metadata: { tenant_id: tenant.id, role: "owner" },
  });

  if (createError || !created.user) {
    await admin.from("tenants").delete().eq("id", tenant.id);
    console.error("convertDemoToTenant:user", createError);
    return {
      error: createError?.message?.includes("already")
        ? "Bu e-posta zaten kayıtlı — muhtemelen zaten müşteri."
        : "Kullanıcı oluşturulamadı.",
    };
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    tenant_id: tenant.id,
    full_name: demo.full_name,
    phone: phone || null,
    role: "owner",
  });

  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    await admin.from("tenants").delete().eq("id", tenant.id);
    console.error("convertDemoToTenant:profile", profileError);
    return { error: "Profil oluşturulamadı." };
  }

  await admin.from("subscriptions").insert({
    tenant_id: tenant.id,
    plan,
    status: "trialing",
    billing_cycle: "monthly",
    amount_try: PLAN_PRICES[plan] ?? 2490,
    trial_ends_at: trialEnds.toISOString(),
    current_period_start: new Date().toISOString(),
  });

  await admin
    .from("demo_requests")
    .update({
      status: "won",
      converted_tenant_id: tenant.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  await admin.from("audit_logs").insert({
    tenant_id: tenant.id,
    actor_id: staff.id,
    action: "sales.convert",
    entity_type: "demo",
    entity_id: id,
    new_value: { tenant_id: tenant.id, slug, plan, email },
  });

  await notifyPlatformStaff({
    title: "🎉 Lead ofise dönüştürüldü",
    body: `${companyName} · ${plan} · 14 gün deneme başladı`,
    href: `/admin/tenants/${tenant.id}`,
    kind: "success",
    meta: { tenant_id: tenant.id, demo_id: id },
  });

  revalidatePath("/admin/satis");
  revalidatePath("/admin/tenants");
  revalidatePath("/admin");

  return {
    ok: true,
    tenantId: tenant.id,
    tenantName: companyName,
    slug,
    email,
    tempPassword,
  };
}
