import { createServerClient } from "@supabase/ssr";
import { guardedFetch } from "./fetch-guard";
import { NextResponse, type NextRequest } from "next/server";
import {
  isTwoFactorCookieValid,
  TWO_FACTOR_COOKIE,
  twoFactorBindingFromClaims,
} from "@/lib/two-factor";
import { resolveSupabasePublicKey } from "@/lib/supabase/keys";
import { AUTH_VERIFIED_HEADER, userFromClaims } from "@/lib/supabase/verified-request";
import { isPlatformMfaRequired } from "@/lib/platform-mfa";
import { isMaintenanceExemptPath, readPlatformFlagsCached } from "@/lib/platform-flags-cache";
import { readProxyGateData } from "@/lib/supabase/proxy-gates";
import { isSuspendedAllowedPath } from "@/lib/suspended-access";
import { GOOGLE_ONBOARDING_PATH, needsOAuthOnboarding, userProviders } from "@/lib/auth/google-auth";

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
    global: { fetch: guardedFetch },
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

  const timing = process.env.EMLAKSOFT_SERVER_TIMING === "1";
  const tAuth0 = timing ? performance.now() : 0;
  // getClaims: gerekirse oturumu yeniler (setAll ile çerez), sonra JWT'yi JWKS (ES256) ile YEREL doğrular — Auth
  // sunucusuna ağ turu yok. Ödün: iptal edilmiş oturum JWT süresi dolana kadar geçer; pasif kullanıcı / askıdaki ofis
  // kapı RPC'sinde her istekte (önbelleksiz) denetlenmeye devam eder. Simetrik anahtarda kütüphane getUser'a düşer.
  const { data: claimsData, error: authError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims as Record<string, unknown> | undefined;
  const user = claims ? userFromClaims(claims) : null;
  const tAuth = timing ? performance.now() - tAuth0 : 0;
  // Süresi dolmuş/iptal edilmiş yenileme anahtarı: oturum yok sayılır ve bozuk auth çerezleri temizlenir
  // (aksi halde her istekte aynı yenileme denenir ve hata günlüğü kirlenir).
  if (!user && authError && /refresh[_ ]token/i.test(`${authError.code ?? ""} ${authError.message ?? ""}`)) {
    for (const c of request.cookies.getAll()) {
      if (c.name.startsWith("sb-") && c.name.includes("auth-token")) supabaseResponse.cookies.delete(c.name);
    }
  }
  let tGates = 0;

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
    // profil + personel + ofis durumu tek RPC'de (yoksa eski üç sorgu; bkz. proxy-gates.ts);
    const tGates0 = timing ? performance.now() : 0;
    const gate = await readProxyGateData(supabase, user.id, tenantId);
    const { profile, profileError } = gate;
    const staff = gate.staff ? { id: user.id } : null;
    const tenant = gate.tenantStatus === null ? null : { status: gate.tenantStatus };
    if (timing) tGates = performance.now() - tGates0;
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

    // Google ile gelip ofis kurulumunu bitirmemiş kullanıcı: oturumu KAPATMADAN kuruluma (döngüsüz;
    // /kayit/tamamla proxy kapısı dışında, ofis claim'i oluşunca bu dal bir daha tetiklenmez).
    if (
      isApp &&
      !canonicalIdentity &&
      needsOAuthOnboarding({
        hasProfile: Boolean(profile),
        profileError: Boolean(profileError),
        isPlatformStaff: Boolean(staff),
        claimTenantId: tenantId || null,
        impersonating,
        providers: userProviders(user),
      })
    ) {
      const redirect = request.nextUrl.clone();
      redirect.pathname = GOOGLE_ONBOARDING_PATH;
      redirect.search = "";
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
      const binding = twoFactorBindingFromClaims(
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

    // JWT yerel doğrulandı + kimlik/askı/2FA kapıları geçti: sunucu bileşenleri aynı yerel doğrulamayı (auth-cache) kullanır.
    {
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

  // Ölçüm (yalnız EMLAKSOFT_SERVER_TIMING=1): proxy'nin ağ doğrulaması ve kapı okumaları ayrı görünür.
  if (timing) supabaseResponse.headers.set("Server-Timing", `proxy-auth;dur=${tAuth.toFixed(1)}, proxy-gates;dur=${tGates.toFixed(1)}`);
  return supabaseResponse;
}
