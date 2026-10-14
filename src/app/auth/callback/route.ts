import type { NextRequest } from "next/server";
import { publicRedirect } from "@/lib/public-redirect";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  isGoogleAuthEnabled,
  oauthErrorCode,
  parseOAuthFlow,
  resolveOAuthLanding,
  safeNextPath,
  type GoogleErrorCode,
  type OAuthFlow,
} from "@/lib/auth/google-auth";
import { isPlatformAllowlistedEmail } from "@/lib/platform";
import { isRegistrationOpen } from "@/lib/platform-flags";
import { TWO_FACTOR_COOKIE } from "@/lib/two-factor";
import { logLoginEvent } from "@/app/giris/_lib/login-events";
import { clientIp } from "@/lib/rate-limit";
import { APP_IDLE_COOKIE } from "@/lib/office-security/policy";
import { officeLoginIpAllowed } from "@/lib/office-security/enforce";

/**
 * Google OAuth dönüşü (Supabase PKCE). Kod, tarayıcı çerezindeki doğrulayıcıyla oturuma çevrilir
 * (state/CSRF Supabase'de); `next` yalnız uygulama içi göreli yol. Karar `resolveOAuthLanding`'de.
 * Yeni service_role kullanımı YOK: kimlik okumaları kullanıcının RLS'li oturumuyla yapılır.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const flow = parseOAuthFlow(url.searchParams.get("akis"));
  const next = safeNextPath(url.searchParams.get("next"));

  const fail = (code: GoogleErrorCode, f: OAuthFlow = flow) => {
    const target = f === "link" ? `/app/hesabim?sekme=parola&google=${code}` : `/giris?hata=${code}`;
    return redirectTo(target);
  };

  if (!isGoogleAuthEnabled()) return fail("google-kapali");

  const providerError = oauthErrorCode({
    error: url.searchParams.get("error"),
    errorCode: url.searchParams.get("error_code"),
    errorDescription: url.searchParams.get("error_description"),
  });
  if (providerError) return fail(providerError);

  const code = url.searchParams.get("code");
  if (!code) return fail("google");

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    console.error("auth callback exchange", exchangeError.code ?? exchangeError.name);
    return fail(
      oauthErrorCode({ error: "server_error", errorCode: exchangeError.code ?? null, errorDescription: exchangeError.message }) ??
        "google",
    );
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return fail("google");

  if (flow === "link") {
    const landing = resolveOAuthLanding({
      flow,
      next,
      email: user.email ?? null,
      claimTenantId: null,
      claimRole: null,
      isPlatformStaff: false,
      profile: null,
      registrationOpen: true,
    });
    return landing.kind === "redirect" ? redirectTo(landing.path) : fail(landing.code);
  }

  const claimTenantId = typeof user.app_metadata?.tenant_id === "string" ? user.app_metadata.tenant_id : null;
  const claimRole = typeof user.app_metadata?.role === "string" ? user.app_metadata.role : null;
  const [{ data: profile, error: profileError }, { data: staff, error: staffError }] = await Promise.all([
    supabase.from("profiles").select("tenant_id, role, is_active, two_factor_sms").eq("id", user.id).maybeSingle(),
    supabase.from("platform_staff").select("id").eq("id", user.id).eq("is_active", true).maybeSingle(),
  ]);
  if (profileError || staffError) {
    console.error("auth callback identity", profileError?.code ?? staffError?.code);
    await supabase.auth.signOut();
    return fail("google");
  }

  const registrationOpen = profile || claimTenantId ? true : await isRegistrationOpen();
  const landing = resolveOAuthLanding({
    flow,
    next,
    email: user.email ?? null,
    claimTenantId,
    claimRole,
    isPlatformStaff: Boolean(staff) || isPlatformAllowlistedEmail(user.email),
    profile: profile
      ? {
          tenant_id: (profile.tenant_id as string | null) ?? null,
          role: (profile.role as string | null) ?? null,
          is_active: (profile.is_active as boolean | null) ?? null,
          two_factor_sms: (profile.two_factor_sms as boolean | null) ?? null,
        }
      : null,
    registrationOpen,
  });

  if (landing.kind === "reject") {
    await supabase.auth.signOut();
    return fail(landing.code);
  }

  // DG7: ofis kullanıcısında ofisin IP kısıtı giriş anında uygulanır (signIn ile aynı; destek/personel muaf).
  if (
    profile?.is_active &&
    !staff &&
    claimTenantId &&
    profile.tenant_id === claimTenantId &&
    !(await officeLoginIpAllowed({ tenantId: claimTenantId, role: profile.role as string | null, headers: await headers() }))
  ) {
    await supabase.auth.signOut();
    await logLoginEvent({
      userId: user.id,
      tenantId: claimTenantId,
      ip: await clientIp(),
      userAgent: (await headers()).get("user-agent"),
      result: "failed",
    });
    return redirectTo("/giris?reason=office_ip");
  }

  // Yeni oturum: eski 2FA kanıt ve boşta kalma çerezleri geçersizdir (signIn ile aynı davranış).
  const jar = await cookies();
  jar.delete(TWO_FACTOR_COOKIE);
  jar.delete(APP_IDLE_COOKIE);
  if (landing.event) {
    await logLoginEvent({
      userId: user.id,
      tenantId: claimTenantId,
      ip: await clientIp(),
      userAgent: (await headers()).get("user-agent"),
      result: landing.event,
    });
  }
  return redirectTo(landing.path);
}

function redirectTo(path: string) {
  const res = publicRedirect(path);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
