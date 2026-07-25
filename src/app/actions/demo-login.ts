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

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "Bilinmeyen hata";
}

async function findAuthUserIdByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
): Promise<string | null> {
  // Önce createUser başarısız olunca kullanılır; sayfalama ile ara
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      console.error("findAuthUserIdByEmail", error);
      return null;
    }
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
    page += 1;
    if (page > 20) return null;
  }
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

  const { error: updErr } = await admin.auth.admin.updateUserById(existingId, {
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: persona.label },
    app_metadata: meta,
  });
  if (updErr) throw new Error(updErr.message);

  return existingId;
}

async function ensureDemoTenant(): Promise<string> {
  const admin = createAdminClient();
  const { data: existingTenant, error: findErr } = await admin
    .from("tenants")
    .select("id")
    .eq("slug", DEMO_TENANT_SLUG)
    .maybeSingle();
  if (findErr) throw new Error(`Ofis sorgusu: ${findErr.message}`);

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

  const { error: subErr } = await admin.from("subscriptions").insert({
    tenant_id: created.id,
    plan: "professional",
    status: "active",
    billing_cycle: "monthly",
    amount_try: 5990,
    current_period_start: new Date().toISOString(),
  });
  // Abonelik opsiyonel — çakışırsa yoksay
  if (subErr) console.warn("demo subscription", subErr.message);

  return created.id;
}

/** Yalnızca tıklanan kişiliği hazırlar (hızlı ilk giriş). */
async function ensurePersona(persona: DemoPersona): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Sunucu yapılandırması eksik (Supabase servis anahtarı).");
  }

  const admin = createAdminClient();
  const tenantId = persona.kind === "office" ? await ensureDemoTenant() : null;
  const userId = await ensureAuthUser(admin, persona, tenantId);

  if (persona.kind === "platform") {
    const { error } = await admin.from("platform_staff").upsert(
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
    if (error) throw new Error(`Personel kaydı: ${error.message}`);
  } else {
    const { error } = await admin.from("profiles").upsert(
      {
        id: userId,
        tenant_id: tenantId,
        full_name: persona.label,
        role: persona.role,
      },
      { onConflict: "id" },
    );
    if (error) throw new Error(`Profil kaydı: ${error.message}`);
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

  // Güvenlik: platform (super_admin/ops...) kişilikleri production'da varsayılan olarak
  // KAPALI — demo modu ofis demoları için açık olsa bile platform admin ele geçirmeyi engelle.
  // Sahip, kontrollü test için Vercel'de ALLOW_PLATFORM_DEMO=true ile geçici açabilir.
  // UYARI: açıkken /admin siteye giren herkese tek tıkla erişilebilir; test sonrası kaldırılmalı.
  const platformDemoAllowed =
    process.env.NODE_ENV !== "production" || process.env.ALLOW_PLATFORM_DEMO === "true";
  if (persona.kind === "platform" && !platformDemoAllowed) {
    return { error: "Bu test kişiliği bu ortamda kullanılamaz." };
  }

  try {
    await ensurePersona(persona);
  } catch (e) {
    console.error("quickDemoLogin:ensure", e);
    return { error: `Demo hesap hazırlanamadı: ${errMsg(e)}` };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: persona.email,
    password: DEMO_PASSWORD,
  });

  if (error) {
    console.error("quickDemoLogin:signIn", error);
    return { error: `Demo giriş başarısız: ${error.message}` };
  }

  redirect(persona.kind === "platform" ? "/admin" : "/app");
}
