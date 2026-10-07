import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  isTwoFactorCookieValid,
  TWO_FACTOR_COOKIE,
  twoFactorBindingFromClaims,
} from "@/lib/two-factor";
import { resolveSupabasePublicKey } from "@/lib/supabase/keys";
import { AUTH_VERIFIED_HEADER, claimsMatchLiveUser } from "@/lib/supabase/verified-request";
import { isPlatformMfaRequired } from "@/lib/platform-mfa";
import { isMaintenanceExemptPath, readPlatformFlagsCached } from "@/lib/platform-flags-cache";
import { isSuspendedAllowedPath } from "@/lib/suspended-access";

/** Bakım sayfası: 503 + Retry-After; yol /bakim'e yeniden yazılır (URL değişmez). */
function maintenanceResponse(request: NextRequest) {
  const rewrite = request.nextUrl.clone();
  rewrite.pathname = "/bakim";
  rewrite.search = "";
  const res = NextResponse.rewrite(rewrite, { status: 503 });
  res.headers.set("Retry-After", "600");
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("X-Robots-Tag", "noindex");
  return res;
}

export async function updateSession(request: NextRequest) {
  // "Ağ ile doğrulandı" işareti yalnız aşağıda, tüm kapılar geçtikten sonra konur; istemcinin gönderdiği silinir.
  request.headers.delete(AUTH_VERIFIED_HEADER);
  let supabaseResponse = NextResponse.next({ request });

  // Bakım modu (K5): kısa TTL önbellekli hafif okuma; okuma hatasında site AÇIK kalır.
  // /app yolları kimlik çözüldükten sonra denetlenir (platform personeli geçer).
  const requestPath = request.nextUrl.pathname;
  let maintenanceOn = false;
  if (!isMaintenanceExemptPath(requestPath)) {
    maintenanceOn = (await readPlatformFlagsCached()).maintenanceMode;
    if (maintenanceOn && !requestPath.startsWith("/app")) {
      return maintenanceResponse(request);
    }
  }

  // Kimlik gerektirmeyen public yollar: oturum çözümü (getUser) yapılmaz.
  const needsAuthResolution =
    requestPath === "/app" ||
    requestPath.startsWith("/app/") ||
    requestPath === "/admin" ||
    requestPath.startsWith("/admin/") ||
    requestPath === "/giris" ||
    requestPath.startsWith("/giris/") ||
    requestPath === "/kayit";
  if (!needsAuthResolution) return supabaseResponse;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = resolveSupabasePublicKey();
  if (!url || !key) return supabaseResponse;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isApp = path.startsWith("/app");
  const isAdmin = path.startsWith("/admin");
  const isAuthPage = path === "/giris" || path === "/kayit";

  if ((isApp || isAdmin) && !user) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/giris";
    redirect.searchParams.set("next", path);
    return NextResponse.redirect(redirect);
  }

  // Optimistic edge gate. Server Actions/Route Handlers and RLS repeat these
  // checks at the data boundary; middleware alone is never authorization.
  if ((isApp || isAdmin) && user) {
    const tenantId = typeof user.app_metadata?.tenant_id === "string"
      ? user.app_metadata.tenant_id
      : "";
    const claimedRole = typeof user.app_metadata?.role === "string"
      ? user.app_metadata.role
      : "";
    const impersonating = user.app_metadata?.impersonating === true;
    // Dördü de birbirinden bağımsız (tenantId JWT'den, DB'den değil) → tek
    // Promise.all'da paralel; her navigasyonda 2 seri round-trip yerine 1.
    const [
      { data: profile, error: profileError },
      { data: staff },
      { data: claimsData, error: claimsError },
      { data: tenant },
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select("tenant_id, role, is_active, two_factor_sms, phone, two_factor_version")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("platform_staff")
        .select("id")
        .eq("id", user.id)
        .eq("is_active", true)
        .maybeSingle(),
      supabase.auth.getClaims(),
      tenantId
        ? supabase.from("tenants").select("status").eq("id", tenantId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const sessionId = claimsData?.claims?.session_id;

    const canonicalTenantUser = Boolean(
      !impersonating &&
      !profileError &&
      profile?.is_active &&
      tenantId &&
      profile.tenant_id === tenantId &&
      profile.role === claimedRole,
    );
    const canonicalImpersonation = Boolean(
      staff &&
      impersonating &&
      tenantId &&
      claimedRole === "readonly" &&
      !claimsError &&
      typeof sessionId === "string" &&
      sessionId &&
      user.app_metadata?.impersonation_session_id === sessionId,
    );
    const canonicalPlatformStaff = Boolean(staff && !impersonating);

    if (maintenanceOn && isApp && !staff) {
      return maintenanceResponse(request);
    }
    const canonicalIdentity = isAdmin
      ? canonicalPlatformStaff
      : canonicalTenantUser || canonicalImpersonation;

    if (isApp && canonicalPlatformStaff && !canonicalTenantUser) {
      const redirect = request.nextUrl.clone();
      redirect.pathname = "/admin";
      redirect.search = "";
      return NextResponse.redirect(redirect);
    }
    if (
      isAdmin &&
      !canonicalPlatformStaff &&
      (canonicalTenantUser || canonicalImpersonation)
    ) {
      const redirect = request.nextUrl.clone();
      redirect.pathname = "/app";
      redirect.search = "";
      return NextResponse.redirect(redirect);
    }

    if (
      isPlatformMfaRequired() &&
      isAdmin &&
      canonicalPlatformStaff &&
      claimsData?.claims?.aal !== "aal2"
    ) {
      const redirect = request.nextUrl.clone();
      redirect.pathname = "/giris/mfa";
      redirect.search = "";
      redirect.searchParams.set("next", path);
      return NextResponse.redirect(redirect);
    }

    if (!canonicalIdentity) {
      await supabase.auth.signOut();
      const redirect = request.nextUrl.clone();
      redirect.pathname = "/giris";
      redirect.search = "";
      redirect.searchParams.set("reason", "inactive_or_invalid_identity");
      return NextResponse.redirect(redirect);
    }

    if (tenantId) {
      const blocked = !tenant || tenant.status === "suspended" || tenant.status === "cancelled";
      if (
        blocked &&
        !(staff && !impersonating) &&
        !isSuspendedAllowedPath(path, tenant?.status)
      ) {
        const redirect = request.nextUrl.clone();
        redirect.pathname = "/app/askida";
        return NextResponse.redirect(redirect);
      }
    }

    if (profile?.is_active && profile.two_factor_sms) {
      const binding = claimsError
        ? null
        : twoFactorBindingFromClaims(
            user.id,
            profile.two_factor_version,
            claimsData?.claims,
          );
      const verified = binding
        ? await isTwoFactorCookieValid(
            request.cookies.get(TWO_FACTOR_COOKIE)?.value,
            binding,
          )
        : false;
      if (!verified) {
        const redirect = request.nextUrl.clone();
        redirect.pathname = "/giris/dogrulama";
        redirect.search = "";
        redirect.searchParams.set("next", path);
        return NextResponse.redirect(redirect);
      }
    }

    // Ağ doğrulaması (getUser) + kimlik/askı/2FA kapıları geçti: sunucu bileşenleri ikinci ağ turu yerine
    // JWKS ile yerel doğrulama yapabilir (auth-cache). Token canlı kullanıcıdan farklıysa işaret konmaz.
    if (!claimsError && claimsMatchLiveUser(user, claimsData?.claims as Record<string, unknown> | undefined)) {
      request.headers.set(AUTH_VERIFIED_HEADER, user.id);
      const verified = NextResponse.next({ request });
      for (const cookie of supabaseResponse.cookies.getAll()) verified.cookies.set(cookie);
      supabaseResponse = verified;
    }
  }

  if (isAuthPage && user) {
    const next = request.nextUrl.searchParams.get("next");
    const redirect = request.nextUrl.clone();
    redirect.search = "";
    if (next && /^\/(?![/\\])/.test(next) && next !== "/app") {
      redirect.pathname = next;
    } else {
      const { data: staff } = await supabase
        .from("platform_staff")
        .select("id")
        .eq("id", user.id)
        .eq("is_active", true)
        .maybeSingle();
      redirect.pathname = staff ? "/admin" : "/app";
    }
    return NextResponse.redirect(redirect);
  }

  return supabaseResponse;
}
