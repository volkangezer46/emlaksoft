"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, resolveSupabaseAdminKey } from "@/lib/supabase/admin";
import { restoreImpersonationMetadata } from "@/lib/impersonation";
import { isPlatformMfaRequired } from "@/lib/platform-mfa";
import { isDemoLoginEnabled, isPlatformDemoPersonaAllowed } from "@/lib/demo-environment";
import { getDemoPersona, type DemoPersona } from "@/lib/demo-personas";
import { planAmountTry } from "@/lib/billing/plans";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { deriveDemoPassword } from "@/lib/demo-credentials";
import { actionErrorMessage } from "@/lib/action-errors";

const DEMO_TENANT_SLUG = "demo-ofis";
const DEMO_TENANT_NAME = "Demo Emlak Ofisi";

/** `redirectTo`: istemcinin tarayıcı gezinmesiyle gideceği adres (platform kişilikleri; yeni oturum çerezleri gönderilsin diye). */
export type DemoLoginResult = { error?: string; redirectTo?: string };

function passwordForDemoIdentity(email: string): string {
  const secret =
    process.env.DEMO_LOGIN_SECRET?.trim() ||
    resolveSupabaseAdminKey() ||
    "";
  return deriveDemoPassword(secret, email);
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
  const password = passwordForDemoIdentity(persona.email);
  const meta =
    persona.kind === "office" && tenantId
      ? { tenant_id: tenantId, role: persona.role }
      : { role: persona.role };

  const { data, error } = await admin.auth.admin.createUser({
    email: persona.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: persona.label },
    app_metadata: meta,
  });

  if (data.user) return data.user.id;

  const already = error && /already|registered|exists|duplicate/i.test(error.message ?? "");
  if (!already) throw new Error(error?.message ?? "Demo kullanıcı oluşturulamadı.");

  const existingId = await findAuthUserIdByEmail(admin, persona.email);
  if (!existingId) throw new Error("Demo kullanıcı bulundu ama kimlik alınamadı.");

  // PAROLAYA DOKUNULMAZ: GoTrue parola değişince hesabın DİĞER TÜM oturumlarını siler; her demo girişinde
  // parola yazmak, aynı kartla giren başka bir kişinin (veya ikinci sekmenin) oturumunu düşürüyordu.
  // Parola yalnız giriş "geçersiz kimlik bilgisi" ile başarısız olursa ayarlanır (resetDemoPassword).
  //
  // GoTrue app_metadata'yı BİRLEŞTİRİR: önceki bir "ofis adına gör" oturumundan kalan
  // impersonating/tenant_id gibi anahtarlar yalnız { role } yazınca silinmez ve hesabı kullanılamaz
  // yapar (platform kimliği "taklit oturumu" sayılıp /app'e atılır). Yalnız GEREKİRSE (parolasız) onarılır.
  const { data: existing, error: getErr } = await admin.auth.admin.getUserById(existingId);
  if (getErr) throw new Error(getErr.message);
  const current = (existing.user?.app_metadata ?? {}) as Record<string, unknown>;
  const desired = restoreImpersonationMetadata({}, meta);
  const metadataOk =
    Object.entries(desired).every(([k, v]) => (current[k] ?? null) === (v ?? null)) &&
    Boolean(existing.user?.email_confirmed_at) &&
    existing.user?.user_metadata?.full_name === persona.label;
  if (!metadataOk) {
    const { error: updErr } = await admin.auth.admin.updateUserById(existingId, {
      email_confirm: true,
      user_metadata: { full_name: persona.label },
      app_metadata: desired,
    });
    if (updErr) throw new Error(updErr.message);
  }

  return existingId;
}

/** Türetilmiş demo parolası tutmuyorsa (ör. sır değişti) BİR KEZ yeniden yazar; bu, o hesabın diğer oturumlarını kapatır. */
async function resetDemoPassword(persona: DemoPersona): Promise<void> {
  const admin = createAdminClient();
  const id = await findAuthUserIdByEmail(admin, persona.email);
  if (!id) throw new Error("Demo kullanıcı bulunamadı.");
  const { error } = await admin.auth.admin.updateUserById(id, { password: passwordForDemoIdentity(persona.email) });
  if (error) throw new Error(error.message);
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
    amount_try: planAmountTry("professional", "monthly"),
    current_period_start: new Date().toISOString(),
  });
  // Abonelik opsiyonel — çakışırsa yoksay
  if (subErr) console.warn("demo subscription", subErr.message);

  return created.id;
}

/** Yalnızca tıklanan kişiliği hazırlar (hızlı ilk giriş). */
async function ensurePersona(persona: DemoPersona): Promise<void> {
  if (persona.kind === "platform" && !isPlatformDemoPersonaAllowed()) {
    throw new Error("Platform demo kişilikleri bu ortamda kesin olarak kapalı.");
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !resolveSupabaseAdminKey()) {
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

  const ip = await clientIp();
  const rate = await checkRateLimit(`demo-login:${ip}`, {
    limit: 60,
    windowSec: 10 * 60,
    failurePolicy: "deny",
  });
  if (!rate.allowed) {
    return { error: "Çok fazla demo giriş denemesi yapıldı. Lütfen daha sonra tekrar deneyin." };
  }

  const persona = getDemoPersona(personaId);
  if (!persona) return { error: "Geçersiz test kişiliği." };

  // Defense in depth: even if the general demo gate is changed later, a
  // privileged platform identity can never be provisioned in production.
  if (persona.kind === "platform" && !isPlatformDemoPersonaAllowed()) {
    return { error: "Platform hızlı girişi bu ortamda kapalı." };
  }

  try {
    await ensurePersona(persona);
  } catch (e) {
    console.error("quickDemoLogin:ensure", e);
    return { error: actionErrorMessage(e, "Demo hesap hazırlanamadı") };
  }

  const supabase = await createClient();
  const credentials = { email: persona.email, password: passwordForDemoIdentity(persona.email) };
  let { error } = await supabase.auth.signInWithPassword(credentials);
  if (error && (error.code === "invalid_credentials" || /invalid login credentials/i.test(error.message))) {
    // Parola türetme sırrı değişmiş (ör. sunucu taşıması): yalnız bu durumda bir kez yeniden yazılır.
    try {
      await resetDemoPassword(persona);
      ({ error } = await supabase.auth.signInWithPassword(credentials));
    } catch (e) {
      console.error("quickDemoLogin:resetPassword", e);
    }
  }

  if (error) {
    console.error("quickDemoLogin:signIn", error);
    return { error: actionErrorMessage(error, "Demo giriş başarısız") };
  }

  // Platform kişilikleri zorunlu iki adımlı doğrulamadan (TOTP) geçer. Sunucu işleminin içinden
  // yönlendirmek, hedef sayfanın işlem sırasında henüz tarayıcıya gitmemiş oturum çerezlerini
  // görememesine yol açıyordu (adres değişiyor, ekran giriş sayfasında kalıyor). Bu yüzden hedef
  // döndürülür ve istemci tarayıcı gezinmesiyle (yeni çerezlerle) doğrulama sayfasına gider.
  if (persona.kind === "platform") {
    // MFA kapalıyken (geliştirme) doğrudan panel; açıkken doğrulama sayfası.
    return { redirectTo: isPlatformMfaRequired() ? `/giris/mfa?next=${encodeURIComponent("/admin")}` : "/admin" };
  }
  redirect("/app");
}
