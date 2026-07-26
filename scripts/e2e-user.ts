/**
 * E2E test kullanıcısı hazırlayıcı (idempotent).
 *
 * - auth.users içinde e2e-test@emlaksoft.local yoksa oluşturur, varsa şifreyi
 *   bilinen sabite resetler (test hesabı — sabit şifre bilinçli).
 * - `e2e-test` slug'lı özel bir tenant'a owner profili bağlar (upsert).
 * - `two_factor_sms=false` garanti eder (2FA login akışını tetiklemesin).
 * - Sonunda anon key ile gerçek bir signInWithPassword yapıp doğrular.
 *
 * Kullanım: npx tsx scripts/e2e-user.ts
 * Gereken env (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * NEXT_PUBLIC_SUPABASE_ANON_KEY
 */
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

export const E2E_EMAIL = "e2e-test@emlaksoft.local";
export const E2E_PASSWORD = "E2e!Emlak-2026-Test";
const TENANT_SLUG = "e2e-test";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !service || !anonKey) {
  console.error("Eksik env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY (.env.local)");
  process.exit(1);
}

// --- Kazara prod'a çalıştırma freni ---------------------------------------
// Hedef DB host'u ve tenant slug'ı her koşulda yazdırılır. Host local değilse
// (hosted Supabase = potansiyel prod) SEED_CONFIRM=1 olmadan script ÇIKAR:
// bilinen sabit şifreli test kullanıcısı prod'a sessizce yazılmasın.
const dbHost = new URL(url).hostname;
const isLocalDb = ["localhost", "127.0.0.1", "0.0.0.0", "kong"].includes(dbHost);
console.log(`Hedef DB: ${dbHost} · hedef tenant: ${TENANT_SLUG}`);
if (!isLocalDb && process.env.SEED_CONFIRM !== "1") {
  console.error(
    `DURDURULDU: '${dbHost}' local bir Supabase değil. Bu hedefe e2e test kullanıcısı yazmak` +
      ` istediğinden eminsen SEED_CONFIRM=1 ile tekrar çalıştır.`,
  );
  process.exit(1);
}

const admin = createClient(url, service, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserByEmail(email: string) {
  // listUsers sayfalı — küçük projelerde ilk sayfalar yeterli, yine de gezelim.
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function ensureTenant(): Promise<string> {
  const { data: existing, error: selErr } = await admin
    .from("tenants")
    .select("id")
    .eq("slug", TENANT_SLUG)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing) return existing.id;

  const { data: created, error: insErr } = await admin
    .from("tenants")
    .insert({
      name: "E2E Test Ofis",
      slug: TENANT_SLUG,
      plan: "professional",
      status: "active",
    })
    .select("id")
    .single();
  if (insErr) throw insErr;
  return created.id;
}

async function main() {
  const tenantId = await ensureTenant();

  let user = await findUserByEmail(E2E_EMAIL);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email: E2E_EMAIL,
      password: E2E_PASSWORD,
      email_confirm: true,
      app_metadata: { tenant_id: tenantId, role: "owner" },
      user_metadata: { full_name: "E2E Test" },
    });
    if (error || !data.user) throw error ?? new Error("createUser: kullanıcı dönmedi");
    user = data.user;
    console.log("auth user OLUSTURULDU:", user.id);
  } else {
    // Şifre/metadata drift'ine karşı bilinen duruma resetle.
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      password: E2E_PASSWORD,
      email_confirm: true,
      app_metadata: { ...user.app_metadata, tenant_id: tenantId, role: "owner" },
    });
    if (error) throw error;
    console.log("auth user MEVCUT, resetlendi:", user.id);
  }

  // Profil upsert — owner rolü, 2FA kapalı (giriş akışı SMS'e sapmasın).
  const { error: pErr } = await admin.from("profiles").upsert({
    id: user.id,
    tenant_id: tenantId,
    full_name: "E2E Test",
    role: "owner",
    is_active: true,
    two_factor_sms: false,
  });
  if (pErr) throw pErr;

  // --- Minimal test verisi (idempotent) -----------------------------------
  // Komut paleti araması ve müşteri/ağ akışları için 2 müşteri + 1 yayında
  // portföy. Varlık kontrolü ada/koda göre — tekrar koşmak kayıt çoğaltmaz.
  const SEED_CUSTOMERS = [
    { full_name: "E2E Müşteri Bir", phone: "05329990001" },
    { full_name: "E2E Müşteri Deniz", phone: "05329990002" },
  ];
  for (const c of SEED_CUSTOMERS) {
    const { data: hit, error: qErr } = await admin
      .from("customers")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("full_name", c.full_name)
      .maybeSingle();
    if (qErr) throw qErr;
    if (hit) continue;
    const { error } = await admin.from("customers").insert({
      tenant_id: tenantId,
      full_name: c.full_name,
      phone: c.phone,
      customer_types: ["Alıcı"],
      created_by: user.id,
    });
    if (error) throw error;
    console.log("müşteri eklendi:", c.full_name);
  }

  const E2E_PROP_CODE = "E2E-001";
  const { data: propHit, error: propQErr } = await admin
    .from("properties")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("property_code", E2E_PROP_CODE)
    .maybeSingle();
  if (propQErr) throw propQErr;
  if (!propHit) {
    const { error } = await admin.from("properties").insert({
      tenant_id: tenantId,
      property_code: E2E_PROP_CODE,
      title: "E2E Test Portföyü 3+1",
      transaction_type: "Satılık",
      property_type: "Daire",
      status: "live",
      published_at: new Date().toISOString(),
      list_price: 5000000,
      created_by: user.id,
      assigned_to: user.id,
    });
    if (error) throw error;
    console.log("portföy eklendi:", E2E_PROP_CODE);
  }

  // Doğrulama: anon key ile gerçek login.
  const anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const { data: sess, error: sErr } = await anon.auth.signInWithPassword({
    email: E2E_EMAIL,
    password: E2E_PASSWORD,
  });
  if (sErr || !sess.session) throw sErr ?? new Error("login doğrulaması başarısız");
  await anon.auth.signOut();

  console.log("E2E-USER-OK", { email: E2E_EMAIL, user: user.id, tenant: tenantId, role: "owner" });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
