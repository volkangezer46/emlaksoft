import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { getPlatformStaffIdentity } from "@/lib/platform";
import { getRequestIdentity } from "@/lib/cache/request";
import {
  TWO_FACTOR_COOKIE,
  isTwoFactorCookieValid,
  twoFactorBindingFromClaims,
} from "@/lib/two-factor";

export type ActiveTenantResult =
  | { ok: true; userId: string; tenantId: string; role: string; impersonating: boolean }
  | { ok: false; error: string };

type CanonicalProfile = {
  tenant_id: string;
  role: string;
  is_active: boolean;
  two_factor_sms: boolean | null;
  two_factor_version: number | null;
};

const BLOCKED = new Set(["suspended", "cancelled"]);

/** Askıdaki ofis ödeme yapıp kendini açabilir; iptal edilmiş ofis destek yoluna gider. */
export function isSuspendedPaymentAllowed(status: string): boolean {
  return status === "suspended";
}

async function twoFactorSatisfiedForProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  profile: Pick<CanonicalProfile, "is_active" | "two_factor_sms" | "two_factor_version"> | null,
): Promise<boolean> {
  if (profile && !profile.is_active) return false;
  if (!profile?.two_factor_sms) return true;

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData?.claims) return false;
  const binding = twoFactorBindingFromClaims(
    userId,
    profile.two_factor_version,
    claimsData.claims,
  );
  if (!binding) return false;

  const jar = await cookies();
  return isTwoFactorCookieValid(jar.get(TWO_FACTOR_COOKIE)?.value, binding);
}

/**
 * Server Action ve Route Handler'lar middleware'i atlayabildigi icin 2FA
 * kaniti veri kaynagina yakin noktada tekrar denetlenir.
 */
export async function twoFactorSatisfied(userId: string): Promise<boolean> {
  const user = await getRequestUser();
  if (!user || user.id !== userId) return false;

  const supabase = await createClient();
  const { data: identity, error } = await getRequestIdentity(userId);
  if (error) return false;
  const profile = identity
    ? { is_active: Boolean(identity.is_active), two_factor_sms: identity.two_factor_sms, two_factor_version: identity.two_factor_version }
    : null;

  if (!profile?.is_active) {
    // Platform personelinin aktif bir tenant profili olmak zorunda degildir;
    // pasif tenant uyeligi platform kimligini devre disi birakmaz.
    return Boolean(await getPlatformStaffIdentity());
  }
  return twoFactorSatisfiedForProfile(supabase, userId, profile);
}

/**
 * Kanonik aktif profil + trusted JWT claim + aktif tenant kapisi.
 * Platform personeli yalnız readonly impersonation hedefinde tenant verisine
 * girer; normal platform operasyonlari kendi requirePlatform* kapilarini kullanir.
 *
 * `requirePermission()` (dolayısıyla hemen her server action) ve sayfa içi
 * doğrudan çağrılar (ör. `listSavedViews`) aynı render/istek içinde bunu
 * birden çok kez tetikleyebiliyor — React `cache()` ile istek başına tek
 * DB round-trip grubu (getRequestUser deseni, bkz. auth-cache.ts).
 */
async function resolveActiveTenant(allowSuspended: boolean): Promise<ActiveTenantResult> {
  const user = await getRequestUser();
  if (!user) return { ok: false, error: "Oturum bulunamadı." };

  const supabase = await createClient();
  // Profil + kendi tenant'ı: istek-içi TEK okuma (kabuk/sayfa kapısı/hoş geldin aynı satırı paylaşır).
  // Aşağıdaki kanonik kimlik, 2FA ve askıya alma kontrolleri AYNEN uygulanır.
  const [{ data: identity, error: profileError }, staff] = await Promise.all([
    getRequestIdentity(user.id),
    getPlatformStaffIdentity(),
  ]);
  if (profileError) return { ok: false, error: "Kimlik profili doğrulanamadı." };
  const profile = identity
    ? {
        tenant_id: identity.tenant_id,
        role: identity.role,
        is_active: Boolean(identity.is_active),
        two_factor_sms: identity.two_factor_sms,
        two_factor_version: identity.two_factor_version,
      }
    : null;

  const meta = (user.app_metadata ?? {}) as Record<string, unknown>;
  const tenantId = typeof meta.tenant_id === "string" ? meta.tenant_id : "";
  const claimedRole = typeof meta.role === "string" ? meta.role : "";
  const impersonating = meta.impersonating === true;

  if (!impersonating) {
    if (!profile?.is_active) {
      return { ok: false, error: "Kullanıcı hesabı pasif." };
    }
    if (!tenantId || profile.tenant_id !== tenantId || profile.role !== claimedRole) {
      return { ok: false, error: "Kimlik ve ofis bilgileri uyuşmuyor." };
    }
  } else {
    if (!staff || !tenantId || claimedRole !== "readonly") {
      return { ok: false, error: "Geçersiz destek oturumu." };
    }
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    const sessionId = claimsData?.claims?.session_id;
    if (
      claimsError ||
      typeof sessionId !== "string" ||
      !sessionId ||
      meta.impersonation_session_id !== sessionId
    ) {
      return { ok: false, error: "Destek oturumu bu tarayıcı oturumuna ait değil." };
    }
    try {
      const { data: snapshot, error: snapshotError } = await createAdminClient()
        .from("platform_impersonation_sessions")
        .select("target_tenant_id, expires_at")
        .eq("staff_id", user.id)
        .eq("auth_session_id", sessionId)
        .maybeSingle();
      if (
        snapshotError ||
        !snapshot ||
        snapshot.target_tenant_id !== tenantId ||
        new Date(snapshot.expires_at).getTime() <= Date.now()
      ) {
        return { ok: false, error: "Destek oturumu sona ermiş veya geçersiz." };
      }
    } catch {
      return { ok: false, error: "Destek oturumu doğrulanamadı." };
    }
  }

  const proofProfile = staff && !profile?.is_active ? null : profile;
  if (!(await twoFactorSatisfiedForProfile(supabase, user.id, proofProfile))) {
    return { ok: false, error: "İki adımlı doğrulama tamamlanmadı." };
  }

  // Kanonik kullanıcıda JWT tenant'ı = profil tenant'ı (yukarıda doğrulandı) → gömülü satır kullanılır;
  // impersonation'da (hedef tenant) ya da gömme boşsa eskisi gibi doğrudan okunur.
  const ownTenant = identity && identity.tenant_id === tenantId && identity.tenant?.status ? { status: identity.tenant.status } : null;
  const { data: tenant, error: tenantError } = ownTenant
    ? { data: ownTenant, error: null }
    : await supabase.from("tenants").select("status").eq("id", tenantId).maybeSingle();
  if (tenantError || !tenant) return { ok: false, error: "Ofis bulunamadı." };
  if (BLOCKED.has(tenant.status) && !(staff && !impersonating)) {
    // P0-12: askıdaki (iptal edilmemiş) ofis yalnız ödeme akışına girebilir.
    if (allowSuspended && isSuspendedPaymentAllowed(tenant.status)) {
      return {
        ok: true,
        userId: user.id,
        tenantId,
        role: profile?.role ?? claimedRole,
        impersonating,
      };
    }
    return { ok: false, error: "Hesap askıda veya iptal. Bu işlem yapılamaz." };
  }

  return {
    ok: true,
    userId: user.id,
    tenantId,
    role: impersonating ? "readonly" : (profile?.role ?? claimedRole),
    impersonating,
  };
}

/** Normal kapı: askıda/iptal ofis bloklanır. */
export const requireActiveTenant = cache(() => resolveActiveTenant(false));

/**
 * Ödeme kapısı: yalnız "suspended" ofis geçer (iptal edilmiş geçmez). Yalnız abonelik
 * ödeme/yükseltme action'ları kullanır; başka hiçbir kapıyı gevşetmez.
 */
export const requireTenantForPayment = cache(() => resolveActiveTenant(true));
