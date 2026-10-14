import { createServerClient } from "@supabase/ssr";
import { guardedFetch } from "./fetch-guard";
// next/server barrel (after/connection/ImageResponse) tum app-page calisma zamanini (~700 KB) proxy paketine ceker;
// proxy her istekte soguk basladigi icin yalniz NextResponse sinifi dogrudan alinir (next/server ayni dosyayi yeniden disa aktarir).
import { NextResponse } from "next/dist/server/web/spec-extension/response";
import type { NextRequest } from "next/server";
import {
  isTwoFactorCookieValid,
  TWO_FACTOR_COOKIE,
  twoFactorBindingFromClaims,
} from "@/lib/two-factor";
import { resolveSupabasePublicKey } from "@/lib/supabase/keys";
import { AUTH_VERIFIED_HEADER, userFromClaims } from "@/lib/supabase/verified-request";
import { isPlatformMfaRequiredNow } from "@/lib/platform-mfa";
import { readPlatformFlagsCached } from "@/lib/platform-flags-cache";
import {
  DEFAULT_MAINTENANCE_SCOPE,
  DEFAULT_RETRY_AFTER_SEC,
  isMaintenanceExemptPath,
  isPathUnderMaintenance,
  maintenanceRetryAfterSec,
} from "@/lib/platform-security/maintenance-scope";
import { now } from "@/lib/clock";
import { readProxyGateData } from "@/lib/supabase/proxy-gates";
import { isSuspendedAllowedPath } from "@/lib/suspended-access";
import { GOOGLE_ONBOARDING_PATH, needsOAuthOnboarding, userProviders } from "@/lib/auth/google-auth";
import { safeNextPath } from "@/lib/auth/safe-next";
import { staticRewriteTarget } from "@/lib/static-home/request";
import { staticHandlerPath } from "@/lib/static-home/registry";
import { enabledStaticIds } from "@/lib/static-home/settings";
import { STATIC_REWRITE_HEADER, staticRewriteToken } from "@/lib/static-home/internal-token";
import { readOfficeSecurityPolicyCached } from "@/lib/office-security/policy-cache";
import { APP_IDLE_COOKIE, MFA_SETUP_PATH, OFFICE_IP_ENV_OVERRIDE, officePolicyIp, policyNeedsProxy } from "@/lib/office-security/policy";
import { IDLE_COOKIE } from "@/lib/platform-security/admin-access";
import { decideOfficeGate } from "@/lib/office-security/proxy-gate";

/** Bakım sayfası: 503 + Retry-After; yol /bakim'e yeniden yazılır (URL değişmez). */
function maintenanceResponse(request: NextRequest, retryAfterSec: number = DEFAULT_RETRY_AFTER_SEC) {
  const rewrite = request.nextUrl.clone();
  rewrite.pathname = "/bakim";
  rewrite.search = "";
  const res = NextResponse.rewrite(rewrite, { status: 503 });
  res.headers.set("Retry-After", String(retryAfterSec));
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("X-Robots-Tag", "noindex");
  return res;
}

export async function updateSession(request: NextRequest) {
  // "Ağ ile doğrulandı" işareti yalnız aşağıda, tüm kapılar geçtikten sonra konur; istemcinin gönderdiği silinir.
  request.headers.delete(AUTH_VERIFIED_HEADER);
  let supabaseResponse = NextResponse.next({ request });

  // Bakım modu (K5): kısa TTL önbellekli hafif okuma; okuma hatasında site AÇIK kalır.
  // Kapsam (AP1): varsayılan yalnız /app; ana sayfa yalnız "Tüm site" kapsamında bakıma düşer.
  // /app yolları kimlik çözüldükten sonra denetlenir (platform personeli geçer).
  const requestPath = request.nextUrl.pathname;
  let maintenanceOn = false;
  let retryAfterSec = DEFAULT_RETRY_AFTER_SEC;
  // Statik sayfa anahtarları aynı bayrak okumasından gelir (muaf yollar zaten statik sunulmaz).
  let staticRoutesRaw: string | null = null;
  if (!isMaintenanceExemptPath(requestPath)) {
    const flags = await readPlatformFlagsCached();
    staticRoutesRaw = flags.staticRoutesRaw;
    if (flags.maintenanceMode) {
      const scope = flags.maintenanceScope ?? DEFAULT_MAINTENANCE_SCOPE;
      const nowMs = now();
      maintenanceOn = isPathUnderMaintenance(requestPath, scope.scope, scope, nowMs);
      retryAfterSec = maintenanceRetryAfterSec(scope, nowMs);
    }
    if (maintenanceOn && !requestPath.startsWith("/app")) {
      return maintenanceResponse(request, retryAfterSec);
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
  if (!needsAuthResolution) {
    // Kayıt defterindeki AÇIK sayfanın belge isteği → saf HTML sürümü (Next/React JS'i yok); istemci gezinmesi normal
    // sayfaya gider. Rota işleyicisi yalnız iç jetonla yanıt verir (doğrudan erişim 404); sorgu dizesi taşınmaz.
    // needsAuthResolution yolları (/app, /admin, /giris, /kayit) bu bloğa hiç girmez; kayıt defteri de onları reddeder.
    const staticId = staticRewriteTarget(
      {
        method: request.method,
        pathname: requestPath,
        searchParams: request.nextUrl.searchParams,
        headers: request.headers,
      },
      enabledStaticIds(staticRoutesRaw),
    );
    const staticToken = staticId ? await staticRewriteToken() : null;
    if (staticId && staticToken) {
      const rewrite = request.nextUrl.clone();
      rewrite.pathname = staticHandlerPath(staticId);
      rewrite.search = "";
      const headers = new Headers(request.headers);
      headers.set(STATIC_REWRITE_HEADER, staticToken);
      return NextResponse.rewrite(rewrite, { request: { headers } });
    }
    return supabaseResponse;
  }

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
    // Eklenti kurulum karşılaması (?bagla=1) giriş sonrası aynı adrese döner; başka sorgu dizesi next'e taşınmaz.
    const bindLanding = path === "/app/ilan-kontrol" && request.nextUrl.searchParams.get("bagla") === "1";
    redirect.searchParams.delete("bagla");
    redirect.searchParams.set("next", bindLanding ? `${path}?bagla=1` : path);
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
    // DG7 ofis güvenlik politikası kapı okumasıyla PARALEL (30 sn önbellekli tüm-ofis görüntüsü; sıcakken ağ yok).
    const [gate, officePolicy] = await Promise.all([
      readProxyGateData(supabase, user.id, tenantId),
      isApp && tenantId && !impersonating ? readOfficeSecurityPolicyCached(tenantId) : Promise.resolve(null),
    ]);
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
      return maintenanceResponse(request, retryAfterSec);
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

    // MFA kararı env + yönetim anahtarından (bayrak önbelleği); geçiş süresinde proxy yönlendirmez
    // (faktörü olan personeli sunucu kimlik kapısı AAL2'ye yollar).
    if (
      isAdmin &&
      canonicalPlatformStaff &&
      claimsData?.claims?.aal !== "aal2" &&
      (await isPlatformMfaRequiredNow())
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

    // DG7 ofis güvenlik politikası (yalnız politika belirlemiş ofisin kanonik kullanıcısında; destek oturumu muaf).
    let officeIdleCookie: string | null = null;
    if (isApp && canonicalTenantUser && policyNeedsProxy(officePolicy)) {
      const decision = await decideOfficeGate({
        policy: officePolicy,
        userId: user.id,
        role: profile?.role,
        twoFactorOn: Boolean(profile?.two_factor_sms),
        ip: officePolicyIp(request.headers),
        claims,
        idleCookieValue: request.cookies.get(APP_IDLE_COOKIE)?.value,
        passive: request.headers.get("next-router-prefetch") === "1" || request.headers.get("purpose") === "prefetch",
        nowSec: Math.floor(now() / 1000),
        secret: process.env.TWO_FACTOR_COOKIE_SECRET,
        envIpOverride: process.env[OFFICE_IP_ENV_OVERRIDE],
      });
      if (decision.kind === "end") {
        // Yalnız BU cihazın oturumu kapanır; temizlenen auth çerezleri yönlendirmeye taşınır (yoksa yerel JWT geçerli kalır).
        await supabase.auth.signOut({ scope: "local" });
        const redirect = request.nextUrl.clone();
        redirect.pathname = "/giris";
        redirect.search = "";
        redirect.searchParams.set("reason", decision.reason);
        if (decision.reason !== "office_ip") redirect.searchParams.set("next", path);
        const res = NextResponse.redirect(redirect);
        for (const cookie of supabaseResponse.cookies.getAll()) res.cookies.set(cookie);
        res.cookies.delete(APP_IDLE_COOKIE);
        res.cookies.delete(TWO_FACTOR_COOKIE);
        return res;
      }
      if (decision.kind === "mfa_setup") {
        const redirect = request.nextUrl.clone();
        redirect.pathname = MFA_SETUP_PATH;
        redirect.search = "";
        redirect.searchParams.set("next", path);
        return NextResponse.redirect(redirect);
      }
      officeIdleCookie = decision.idleCookie;
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
      if (officeIdleCookie) {
        verified.cookies.set(APP_IDLE_COOKIE, officeIdleCookie, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 7 * 86_400,
        });
      }
      supabaseResponse = verified;
    }
  }

  if (isAuthPage && user) {
    const next = request.nextUrl.searchParams.get("next");
    const redirect = request.nextUrl.clone();
    redirect.search = "";
    const safe = safeNextPath(next, "");
    if (safe && safe !== "/app") {
      const target = new URL(safe, "http://emlaksoft.invalid");
      redirect.pathname = target.pathname;
      redirect.search = target.search;
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

  // AD11/DG7: giriş sayfaları önceki oturumdan kalan boşta kalma çerezlerini YALNIZ oturum yokken düşürür (yoksa yeni
  // açılan oturum ilk isteğinde eski etkinlik zamanıyla hemen kapanırdı). Oturum açıkken silinirse /giris'e uğrayıp
  // dönen kişi boşta kalma süresini sıfırlamış olurdu (paylaşılan bilgisayar); o durumda yukarıdaki yönlendirme
  // /app ya da /admin'e gider ve oradaki boşta kalma kararı eski çerezle verilir. signIn/signOut da siler.
  if (!user && path.startsWith("/giris")) {
    for (const name of [IDLE_COOKIE, APP_IDLE_COOKIE]) {
      if (request.cookies.has(name)) supabaseResponse.cookies.delete(name);
    }
  }

  // Ölçüm (yalnız EMLAKSOFT_SERVER_TIMING=1): proxy'nin ağ doğrulaması ve kapı okumaları ayrı görünür.
  if (timing) supabaseResponse.headers.set("Server-Timing", `proxy-auth;dur=${tAuth.toFixed(1)}, proxy-gates;dur=${tGates.toFixed(1)}`);
  return supabaseResponse;
}
