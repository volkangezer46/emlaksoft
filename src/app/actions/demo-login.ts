"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDemoPersona, isDemoLoginEnabled, type DemoPersona } from "@/lib/demo-personas";

/** Tüm demo hesapların ortak parolası — yalnızca sunucuda. */
const DEMO_PASSWORD = "Demo1234!";
const DEMO_TENANT_SLUG = "demo-ofis";
const DEMO_TENANT_NAME = "Demo Emlak Ofisi";

export type DemoLoginResult = { error?: string };

async function findAuthUserIdByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
): Promise<string | null> {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) {
    console.error("findAuthUserIdByEmail", error);
    return null;
  }
  const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  return hit?.id ?? null;
}

async function ensureAuthUser(
  admin: ReturnType<typeof createAdminClient>,
  persona: DemoPersona,
  tenantId: string | null,
): Promise<string> {
  const meta =
    persona.kind === "office" && tenantId
      ? { tenant_id: tenantId, role: persona.role }
      : { role: persona.role };

  const { data, error } = await admin.auth.admin.createUser({
    email: persona.email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: persona.label },
    app_metadata: meta,
  });

  if (data.user) return data.user.id;

  const already = error && /already|registered|exists|duplicate/i.test(error.message ?? "");
  if (!already) throw new Error(error?.message ?? "Demo kullanıcı oluşturulamadı.");

  const existingId = await findAuthUserIdByEmail(admin, persona.email);
  if (!existingId) throw new Error("Demo kullanıcı bulundu ama kimlik alınamadı.");

  await admin.auth.admin.updateUserById(existingId, {
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: persona.label },
    app_metadata: meta,
  });
  return existingId;
}

async function ensureDemoTenant(): Promise<string> {
  const admin = createAdminClient();
  const { data: existingTenant } = await admin
    .from("tenants")
    .select("id")
    .eq("slug", DEMO_TENANT_SLUG)
    .maybeSingle();

  if (existingTenant?.id) return existingTenant.id;

  const trialEnds = new Date();
  trialEnds.setDate(trialEnds.getDate() + 365);
  const { data: created, error } = await admin
    .from("tenants")
    .insert({
      name: DEMO_TENANT_NAME,
      slug: DEMO_TENANT_SLUG,
      plan: "professional",
      status: "active",
      trial_ends_at: trialEnds.toISOString(),
    })
    .select("id")
    .single();
  if (error || !created) throw new Error(error?.message ?? "Demo ofis oluşturulamadı.");

  await admin.from("subscriptions").insert({
    tenant_id: created.id,
    plan: "professional",
    status: "active",
    billing_cycle: "monthly",
    amount_try: 5990,
    current_period_start: new Date().toISOString(),
  });

  return created.id;
}

/** Yalnızca tıklanan kişiliği hazırlar (hızlı ilk giriş). */
async function ensurePersona(persona: DemoPersona): Promise<void> {
  const admin = createAdminClient();
  const tenantId = persona.kind === "office" ? await ensureDemoTenant() : null;
  const userId = await ensureAuthUser(admin, persona, tenantId);

  if (persona.kind === "platform") {
    await admin.from("platform_staff").upsert(
      {
        id: userId,
        email: persona.email.toLowerCase(),
        full_name: persona.label,
        role: persona.role,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
  } else {
    await admin.from("profiles").upsert(
      {
        id: userId,
        tenant_id: tenantId,
        full_name: persona.label,
        role: persona.role,
      },
      { onConflict: "id" },
    );
  }
}

/**
 * Tek tıkla demo kişiliğe giriş. Yalnızca demo modu açıkken çalışır.
 */
export async function quickDemoLogin(personaId: string): Promise<DemoLoginResult> {
  if (!isDemoLoginEnabled()) {
    return { error: "Hızlı test girişi bu ortamda kapalı." };
  }

  const persona = getDemoPersona(personaId);
  if (!persona) return { error: "Geçersiz test kişiliği." };

  try {
    await ensurePersona(persona);
  } catch (e) {
    console.error("quickDemoLogin:ensure", e);
    return { error: "Demo hesap hazırlanamadı. Ortam değişkenlerini kontrol edin." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: persona.email,
    password: DEMO_PASSWORD,
  });

  if (error) {
    console.error("quickDemoLogin:signIn", error);
    return { error: "Demo giriş başarısız. Lütfen tekrar deneyin." };
  }

  redirect(persona.kind === "platform" ? "/admin" : "/app");
}
