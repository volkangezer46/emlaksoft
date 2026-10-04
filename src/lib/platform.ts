import { cache } from "react";
import { isPlatformMfaRequired } from "@/lib/platform-mfa";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { platformCanAccess, type PlatformModule, type PlatformRole } from "@/lib/platform-access";

export type { PlatformRole };

export type PlatformStaff = {
  id: string;
  email: string;
  full_name: string;
  role: PlatformRole;
  is_active: boolean;
};

function allowlist(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Ensure allowlisted emails are inserted into platform_staff on first access. */
export async function bootstrapPlatformStaffIfAllowed(
  userId: string,
  email: string,
  fullName: string,
) {
  const list = allowlist();
  if (!list.includes(email.toLowerCase())) return null;

  const admin = createAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("platform_staff")
    .select("id, email, full_name, role, is_active")
    .eq("id", userId)
    .maybeSingle();
  if (existingError) {
    console.error("platform bootstrap lookup", existingError);
    return null;
  }
  // An explicit deactivation is authoritative. The environment allowlist may
  // bootstrap a never-seen identity, but must never reactivate or promote it.
  if (existing) return existing.is_active ? (existing as PlatformStaff) : null;

  const { data, error } = await admin
    .from("platform_staff")
    .insert({
      id: userId,
      email: email.toLowerCase(),
      full_name: fullName || email,
      role: "super_admin",
      is_active: true,
      updated_at: new Date().toISOString(),
    })
    .select("id, email, full_name, role, is_active")
    .single();

  if (error) {
    // Concurrent first access may win the insert. Re-read without mutating;
    // an inactive winner remains inactive and no role is overwritten.
    if (error.code === "23505") {
      const { data: raced } = await admin
        .from("platform_staff")
        .select("id, email, full_name, role, is_active")
        .eq("id", userId)
        .maybeSingle();
      return raced?.is_active ? (raced as PlatformStaff) : null;
    }
    console.error("platform bootstrap", error);
    return null;
  }
  return data as PlatformStaff;
}

/**
 * Active platform record before the mandatory AAL2 check. This is exported
 * only for the MFA enrollment/challenge page; authorization must use
 * `getPlatformStaffIdentity`, `getPlatformStaff` or `requirePlatform*`.
 */
export const getPlatformMfaCandidate = cache(async (): Promise<PlatformStaff | null> => {
  const user = await getRequestUser();
  if (!user?.email) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("platform_staff")
    .select("id, email, full_name, role, is_active")
    .eq("id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (data) return data as PlatformStaff;

  const name =
    (user.user_metadata?.full_name as string | undefined) ??
    user.email.split("@")[0] ??
    "Staff";
  return bootstrapPlatformStaffIfAllowed(user.id, user.email, name);
});

/** Active platform identity with a session-level Supabase AAL2 proof. */
const getPlatformStaffIdentityBase = cache(async (): Promise<PlatformStaff | null> => {
  const staff = await getPlatformMfaCandidate();
  if (!staff) return null;
  // Geliştirme sürecinde AAL2 şartı kapalı (bkz. src/lib/platform-mfa.ts).
  if (!isPlatformMfaRequired()) return staff;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || data.currentLevel !== "aal2") return null;
  return staff;
});

/** Geçici parolayla açılmış hesap: kendi parolasını belirleyene dek yalnız parola değiştirme ve çıkış serbesttir. */
export function mustChangePassword(user: { user_metadata?: Record<string, unknown> } | null | undefined): boolean {
  return user?.user_metadata?.must_change_password === true;
}

/** AAL2 kanıtlı personel kimliği; parolası değişmemiş hesap için null (ofise bürünme dahil hiçbir yetki yok). */
export const getPlatformStaffIdentity = cache(async (): Promise<PlatformStaff | null> => {
  const staff = await getPlatformStaffIdentityBase();
  if (!staff) return null;
  if (mustChangePassword(await getRequestUser())) return null;
  return staff;
});

/**
 * Parola değişimi beklese bile personel kimliği. YALNIZ zorunlu parola ekranı (admin layout, /admin/hesabim)
 * ve kendi hesabı action'ları (`platform-account.ts`) kullanır; başka hiçbir yer çağırmaz
 * (sözleşme testi: platform-password-gate-contract.test.ts).
 */
export const getPlatformStaffUnrestricted = cache(async (): Promise<PlatformStaff | null> => {
  const user = await getRequestUser();
  if (!user || user.app_metadata?.impersonating === true) return null;
  return getPlatformStaffIdentityBase();
});

/**
 * Platform capability identity. Readonly impersonation never carries admin powers.
 * Parolası değişmemiş personel için null döner: tüm admin action'ları ve /api/admin rotaları reddedilir.
 */
export const getPlatformStaff = cache(async (): Promise<PlatformStaff | null> => {
  const user = await getRequestUser();
  if (!user || user.app_metadata?.impersonating === true) return null;
  return getPlatformStaffIdentity();
});

export async function requirePlatformStaff(): Promise<PlatformStaff> {
  const staff = await getPlatformStaff();
  if (!staff) {
    const user = await getRequestUser();
    if (!user) redirect("/giris?next=/admin");
    if (mustChangePassword(user) && (await getPlatformStaffUnrestricted())) redirect("/admin/hesabim");
    const candidate = await getPlatformMfaCandidate();
    if (candidate && user.app_metadata?.impersonating !== true) {
      redirect("/giris/mfa?next=/admin");
    }
    redirect("/app");
  }
  return staff;
}

/** Zorunlu parola ekranı için kapı (bkz. `getPlatformStaffUnrestricted`). */
export async function requirePlatformStaffForAccount(): Promise<PlatformStaff> {
  const staff = await getPlatformStaffUnrestricted();
  if (staff) return staff;
  return requirePlatformStaff();
}

/**
 * Sayfa/aksiyon seviyesi departman yetkisi. Personel değilse `requirePlatformStaff`
 * gibi yönlendirir; modüle erişimi yoksa kendi dashboard'una (/admin) döner.
 */
export async function requirePlatformModule(module: PlatformModule): Promise<PlatformStaff> {
  const staff = await requirePlatformStaff();
  if (!platformCanAccess(staff.role, module)) {
    redirect("/admin");
  }
  return staff;
}
