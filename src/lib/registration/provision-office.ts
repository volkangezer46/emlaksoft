import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { normalizeBillingCycle } from "@/lib/billing/plans";
import { normalizeRegistrationTeamSize, registrationPlanForTeamSize } from "@/lib/billing/registration-plan";
import { recordSignupAttributionFromRequest } from "@/lib/growth/capture";
import { DEMO_SEED_FAILED_COOKIE, seedDemoDataForNewTenant, wantsDemoData } from "@/lib/sample-registration-seed";
import { FIELD as WIZARD_FIELD, readWizardOfficeProfile } from "@/lib/sample-data/office-profile";
import { applyWizardOfficeProfile } from "@/lib/sample-data/apply-office-profile";

/** Kayıt rızası sürümleri (registration_consents; e-posta ve Google yolu AYNI metinleri onaylatır). */
export const REGISTRATION_TERMS_VERSION = "kullanim-sartlari-2026-07-31";
export const REGISTRATION_KVKK_VERSION = "kvkk-aydinlatma-2026-07-31";

export function slugifyOfficeName(input: string) {
  return input
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/ı/g, "i")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export type ProvisionOfficeInput = {
  /** Kimliği doğrulanmış (e-posta yolu: yeni oluşturulan; Google yolu: oturumdaki) auth kullanıcısı. */
  userId: string;
  email: string;
  fullName: string;
  /** parsePhoneStrict'ten geçmiş saklama biçimi (TR cep) ya da "". */
  phone: string;
  company: string;
  formData: FormData;
  ip: string | null;
  userAgent: string;
};

export type ProvisionOfficeResult =
  | { ok: true; tenantId: string }
  | { ok: false; error: unknown };

/**
 * Ofis provizyon ÇEKİRDEĞİ — `signUp` (e-posta/şifre ve Google tamamlama) tek bu yolu kullanır:
 * atomik `provision_registration` RPC (ofis + profil + abonelik + rıza kaydı) → büyüme atfı →
 * sihirbaz profili (best-effort) → "Demo veriyle başla" örnek seti (best-effort).
 *
 * `admin` çağıranın mevcut service_role istemcisidir (yeni createAdminClient kullanımı yok).
 * Auth kullanıcısının telafisi (silme) ÇAĞIRANIN işidir: Google kullanıcısı silinmez, yeniden dener.
 */
export async function provisionOfficeForUser(
  admin: SupabaseClient,
  publicClient: SupabaseClient,
  input: ProvisionOfficeInput,
): Promise<ProvisionOfficeResult> {
  const { formData } = input;
  const teamSize = normalizeRegistrationTeamSize(String(formData.get("agents") ?? "2-10"));
  // Fiyat sayfasından gelen paket/dönem yalnız izinli değerlere normalize edilir (allowlist).
  const requestedPlan = String(formData.get("plan") ?? "").trim();
  const requestedCycle = String(formData.get("cycle") ?? "").trim();
  const plan = registrationPlanForTeamSize(requestedPlan, teamSize);
  const billingCycle = normalizeBillingCycle(requestedCycle);

  const { data: provisioned, error: provisionError } = await admin.rpc("provision_registration", {
    p_user_id: input.userId,
    p_company: input.company,
    p_slug_base: slugifyOfficeName(input.company) || "ofis",
    p_full_name: input.fullName,
    p_phone: input.phone || null,
    p_plan: plan,
    p_billing_cycle: billingCycle,
    p_team_size: teamSize,
    p_terms_version: REGISTRATION_TERMS_VERSION,
    p_kvkk_version: REGISTRATION_KVKK_VERSION,
    p_ip_address: input.ip ? input.ip.slice(0, 128) : null,
    p_user_agent: input.userAgent || null,
  });
  const tenantId =
    provisioned &&
    typeof provisioned === "object" &&
    !Array.isArray(provisioned) &&
    typeof (provisioned as Record<string, unknown>).tenantId === "string"
      ? ((provisioned as Record<string, unknown>).tenantId as string)
      : null;
  if (provisionError || !tenantId) {
    console.error("provisionOffice provision_registration", provisionError);
    return { ok: false, error: provisionError };
  }

  await recordSignupAttributionFromRequest(tenantId, formData); // büyüme atfı: en iyi çaba, asla fırlatmaz

  // Sihirbaz profili (konum, ofis türü, marka, odak, ekip daveti): best-effort, kayıt akışını kesmez.
  const wizard = readWizardOfficeProfile(formData, input.email);
  const logoField = formData.get(WIZARD_FIELD.logo);
  const logo = typeof logoField === "object" && logoField !== null && "arrayBuffer" in logoField ? (logoField as File) : null;
  await applyWizardOfficeProfile(admin, publicClient, { tenantId, ownerId: input.userId, profile: wizard, logo }).catch((e) =>
    console.error("provisionOffice applyWizardOfficeProfile", e),
  );

  // "Demo verileriyle başla": is_sample işaretli tam demo set; hata kaydı engellemez.
  if (wantsDemoData(formData)) {
    const demoSeed = await seedDemoDataForNewTenant(admin, tenantId, input.userId, wizard.pack);
    if (!demoSeed.ok) {
      // Kayıt başarılı ama örnek veri yüklenemedi: ana ekran "yeniden dene" bandı için kısa ömürlü işaret.
      (await cookies()).set(DEMO_SEED_FAILED_COOKIE, "1", {
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
        sameSite: "lax",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
      });
    }
  }

  return { ok: true, tenantId };
}
