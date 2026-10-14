import { cache } from "react";
import { getPlatformMfaPolicyNow, mfaRequiredFor } from "@/lib/platform-security/mfa-policy";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import {
  isPlatformBaseRole,
  normalizeMatrix,
  platformCan,
  type PlatformAction,
  type PlatformCustomRole,
  type PlatformModule,
  type PlatformRole,
} from "@/lib/platform-access";
import { gateAction } from "@/lib/platform-action-phase";
import { sessionExpired, sessionStartSec } from "@/lib/platform-security/admin-access";
import { readAdminAccessPolicyCached } from "@/lib/platform-security/admin-access-cache";
import { now } from "@/lib/clock";

export type { PlatformRole };

export type PlatformStaff = {
  id: string;
  email: string;
  full_name: string;
  role: PlatformRole;
  is_active: boolean;
  /** DG1 özel rolü: atanmışsa modül × eylem yetkisi YALNIZ bundan gelir (`role` = özel rolün taban rolü). */
  customRole?: PlatformCustomRole | null;
};

const STAFF_COLS = "id, email, full_name, role, is_active";
/** DG1: özel rol gömmesi (FK platform_staff.custom_role_id -> platform_custom_roles). */
const STAFF_COLS_WITH_ROLE = `${STAFF_COLS}, custom_role_id, custom_role:platform_custom_roles!platform_staff_custom_role_id_fkey(id, label, base_role, permissions)`;
/** Migration uygulanmadan önce sütun/ilişki yok hataları: eski sorguya düşülür (yetki taban roldür, özel rol yoktur). */
const SCHEMA_PENDING = new Set(["42703", "42P01", "PGRST200", "PGRST204"]);

export type StaffRowWithRole = Omit<PlatformStaff, "customRole"> & {
  custom_role_id?: string | null;
  custom_role?: { id: string; label: string; base_role: string; permissions: unknown } | null;
};

/**
 * Satırdan personel kimliğini kurar. FAIL-CLOSED: `custom_role_id` dolu ama rol okunamadıysa (RLS, silinme yarışı)
 * taban rolün yetkileri VERİLMEZ; yalnız Genel bakış görünür (boş matris).
 */
export function staffFromRow(row: StaffRowWithRole): PlatformStaff {
  const { custom_role_id, custom_role, ...base } = row;
  if (!custom_role_id) return { ...base, customRole: null };
  const r = custom_role;
  const customRole: PlatformCustomRole = r
    ? {
        id: r.id,
        label: r.label,
        baseRole: isPlatformBaseRole(r.base_role) ? r.base_role : "support",
        permissions: normalizeMatrix(r.permissions),
      }
    : { id: custom_role_id, label: "Özel rol (okunamadı)", baseRole: "support", permissions: {} };
  return { ...base, customRole };
}

function allowlist(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** E-posta platform personeli ön-izin listesinde mi (PLATFORM_ADMIN_EMAILS). Google ile ofis açma kapısı kullanır. */
export function isPlatformAllowlistedEmail(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  return e !== "" && allowlist().includes(e);
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
  const withRole = await supabase
    .from("platform_staff")
    .select(STAFF_COLS_WITH_ROLE)
    .eq("id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  let data = (withRole.data as unknown as StaffRowWithRole | null) ?? null;
  if (withRole.error && SCHEMA_PENDING.has(withRole.error.code ?? "")) {
    const legacy = await supabase.from("platform_staff").select(STAFF_COLS).eq("id", user.id).eq("is_active", true).maybeSingle();
    data = (legacy.data as StaffRowWithRole | null) ?? null;
  } else if (withRole.error) {
    // Okuma hatası: ön-izin listesi önyüklemesine DÜŞÜLMEZ (o yol özel rolü okumaz; taban rol yetkisi sızardı).
    return null;
  }

  if (data) return staffFromRow(data);

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
  // AAL2 şartı env + yönetim anahtarından (bkz. src/lib/platform-mfa.ts); zorunlu değilse parola yeter.
  const policy = await getPlatformMfaPolicyNow();
  if (!policy.enforced) return staff;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) return null;
  // Geçiş süresinde doğrulayıcısı olmayan personel parolayla girer (nextLevel aal2 = doğrulanmış faktör var).
  if (!mfaRequiredFor(policy, data.nextLevel === "aal2")) return staff;
  if (data.currentLevel !== "aal2") return null;
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
 * AD11 oturum ömrü: personel oturumu `platform.session_max_hours` saatten eskiyse (JWT `amr` giriş zamanı) yönetim
 * yetkisi düşer ve sayfa kapısı /giris/oturum-sonu'na yollar. Bürünme (destek erişimi) kendi 4 saat sınırıyla yönetilir.
 * Okuma hatası = süre dolmamış sayılır (kimlik kapıları ayrıca geçerli).
 */
export const isPlatformSessionExpired = cache(async (): Promise<boolean> => {
  try {
    const policy = await readAdminAccessPolicyCached();
    if (policy.maxHours <= 0) return false;
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims) return false;
    return sessionExpired(sessionStartSec(data.claims as Record<string, unknown>), Math.floor(now() / 1000), policy.maxHours);
  } catch {
    return false;
  }
});

/**
 * Platform capability identity. Readonly impersonation never carries admin powers.
 * Parolası değişmemiş personel için null döner: tüm admin action'ları ve /api/admin rotaları reddedilir.
 */
export const getPlatformStaff = cache(async (): Promise<PlatformStaff | null> => {
  const user = await getRequestUser();
  if (!user || user.app_metadata?.impersonating === true) return null;
  const staff = await getPlatformStaffIdentity();
  if (staff && (await isPlatformSessionExpired())) return null;
  return staff;
});

export async function requirePlatformStaff(): Promise<PlatformStaff> {
  const staff = await getPlatformStaff();
  if (!staff) {
    const user = await getRequestUser();
    if (!user) redirect("/giris?next=/admin");
    // Süresi dolmuş personel oturumu (kimlik geçerli, yalnız ömür aşıldı): oturumu kapatıp girişe yolla.
    if (user.app_metadata?.impersonating !== true && (await getPlatformStaffIdentity()) && (await isPlatformSessionExpired())) {
      redirect("/giris/oturum-sonu?neden=sure");
    }
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
 * gibi yönlendirir; modüle (ya da istenen eyleme) yetkisi yoksa kendi dashboard'una (/admin) döner.
 */
export async function requirePlatformModule(module: PlatformModule, action?: PlatformAction): Promise<PlatformStaff> {
  const staff = await requirePlatformStaff();
  if (!platformCan(staff, module, gateAction(action))) {
    redirect("/admin");
  }
  return staff;
}
