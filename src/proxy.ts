import type { NextRequest } from "next/server";
// middleware.ts ile aynı gerekçe: next/server barrel yerine yalnız NextResponse sınıfı (proxy paket boyutu).
import { NextResponse } from "next/dist/server/web/spec-extension/response";
import { updateSession } from "@/lib/supabase/middleware";
import { AUTH_VERIFIED_HEADER } from "@/lib/supabase/verified-request";
import { now } from "@/lib/clock";
import {
  IDLE_COOKIE,
  adminIpAllowed,
  decideIdle,
  isAdminPolicyPath,
  signIdleCookie,
  verifyIdleCookie,
} from "@/lib/platform-security/admin-access";
import { readAdminAccessPolicyCached } from "@/lib/platform-security/admin-access-cache";
import { getBaseUrl } from "@/lib/base-url";
import {
  CSP_REPORT_PATH,
  buildReportOnlyCsp,
  isReportOnlyPath,
  newCspNonce,
  reportOnlyEnabled,
  reportingEndpointsHeader,
} from "@/lib/security/csp-report-only";

/** Traefik X-Real-Ip/X-Forwarded-For'u kendisi yazar (istemcinin gönderdiğini geçirmez). */
function clientIp(request: NextRequest): string | null {
  return request.headers.get("x-real-ip")?.trim() || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

function forbidden(path: string) {
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
  if (path.startsWith("/api/")) {
    return NextResponse.json({ error: "Bu IP adresinden yönetim paneline erişim kapalı." }, { status: 403, headers });
  }
  return new NextResponse(
    '<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      "<title>Erişim engellendi</title><body style=\"font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;color:#0f172a\">" +
      "<h1 style=\"font-size:1.25rem\">Erişim engellendi (403)</h1>" +
      "<p>Yönetim paneline yalnız izin verilen IP adreslerinden erişilebilir. Erişim gerekiyorsa süper admin ile görüşün.</p></body></html>",
    { status: 403, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } },
  );
}

/**
 * Boşta kalma zaman aşımı (yalnız kapıları geçmiş /admin sayfa istekleri). İmzalı etkinlik çerezi süreyi aşmışsa
 * oturum /giris/oturum-sonu'nda kapatılır; önceden yükleme (prefetch) istekleri etkinlik sayılmaz.
 */
async function applyIdlePolicy(request: NextRequest, response: NextResponse, idleMinutes: number): Promise<NextResponse> {
  const userId = request.headers.get(AUTH_VERIFIED_HEADER);
  const secret = process.env.TWO_FACTOR_COOKIE_SECRET;
  if (!userId || !secret || response.headers.get("x-middleware-next") !== "1") return response;
  const nowSec = Math.floor(now() / 1000);
  const last = await verifyIdleCookie(request.cookies.get(IDLE_COOKIE)?.value, userId, secret);
  const passive = request.headers.get("next-router-prefetch") === "1" || request.headers.get("purpose") === "prefetch";
  const decision = decideIdle(last, nowSec, idleMinutes, passive);
  if (decision.kind === "expired") {
    const url = request.nextUrl.clone();
    url.pathname = "/giris/oturum-sonu";
    url.search = "";
    url.searchParams.set("neden", "bosta");
    const redirect = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    redirect.cookies.delete(IDLE_COOKIE);
    return redirect;
  }
  if (decision.kind === "refresh") {
    response.cookies.set(IDLE_COOKIE, await signIdleCookie(userId, nowSec, secret), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 86_400,
    });
  }
  return response;
}

const CSP_REPORT_ONLY_REQUEST_HEADER = "content-security-policy-report-only";

/**
 * CSP ölçümü (yalnız rapor modu; src/lib/security/csp-report-only.ts): /app ve /admin belgelerinde istek başına nonce.
 * Politika İSTEK başlığına da yazılır: Next nonce'u buradan okuyup kendi betiklerine ekler; yanıt başlığı tarayıcıya
 * gider. İstemcinin gönderdiği aynı adlı başlık her yolda silinir (nonce'u dışarıdan dayatamasın).
 */
function prepareReportOnlyCsp(request: NextRequest, path: string): string | null {
  request.headers.delete(CSP_REPORT_ONLY_REQUEST_HEADER);
  if (!reportOnlyEnabled() || !isReportOnlyPath(path)) return null;
  const policy = buildReportOnlyCsp(newCspNonce(), `${getBaseUrl()}${CSP_REPORT_PATH}`);
  request.headers.set(CSP_REPORT_ONLY_REQUEST_HEADER, policy);
  return policy;
}

function withReportOnlyCsp(response: NextResponse, policy: string | null): NextResponse {
  if (!policy) return response;
  response.headers.set("Content-Security-Policy-Report-Only", policy);
  response.headers.set("Reporting-Endpoints", reportingEndpointsHeader(`${getBaseUrl()}${CSP_REPORT_PATH}`));
  return response;
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const cspPolicy = prepareReportOnlyCsp(request, path);
  if (!isAdminPolicyPath(path)) {
    // AD11/DG7: giriş sayfalarında eski boşta kalma çerezleri updateSession'da, YALNIZ oturum yokken düşer.
    return withReportOnlyCsp(await updateSession(request), cspPolicy);
  }

  // AD11: yönetim IP izin listesi kimlik çözümünden ÖNCE (izinsiz IP oturum çerezi bile işletmez).
  const policy = await readAdminAccessPolicyCached();
  if (!adminIpAllowed(policy, clientIp(request), process.env.ADMIN_IP_ALLOWLIST)) return forbidden(path);
  // /api/admin rotaları kimliği kendileri doğrular; proxy yalnız IP kapısıdır.
  // İstemcinin gönderdiği "kapılar geçti" işareti burada da silinir (proxy kapıları bu yolda çalışmaz).
  if (path.startsWith("/api/")) {
    request.headers.delete(AUTH_VERIFIED_HEADER);
    return NextResponse.next({ request });
  }

  const response = await updateSession(request);
  return withReportOnlyCsp(await applyIdlePolicy(request, response, policy.idleMinutes), cspPolicy);
}

export const config = {
  // Kimlik-doğrulama yalnız /app, /admin, /giris, /kayit için çözülür (getUser() ağ çağrısı);
  // diğer public sayfalarda yalnız bakım modu bayrağı (30 sn bellek önbellekli) okunur.
  // API (cron, webhook, health), _next ve uzantılı statik dosyalar proxy dışındadır; tek istisna /api/admin
  // (yalnız AD11 IP izin listesi kapısı).
  matcher: ["/((?!api/|_next/|.*\\..*).*)", "/api/admin/:path*"],
};
