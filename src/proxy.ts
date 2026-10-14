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
import { APP_IDLE_COOKIE } from "@/lib/office-security/policy";

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

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (!isAdminPolicyPath(path)) {
    const response = await updateSession(request);
    // AD11: giriş sayfaları önceki oturumdan kalan boşta kalma çerezini düşürür (yoksa yeni açılan oturum ilk /admin
    // isteğinde eski etkinlik zamanıyla hemen kapanırdı). signIn/signOut da siler; bu, diğer giriş yollarını kapsar.
    if (path.startsWith("/giris") && request.cookies.has(IDLE_COOKIE)) response.cookies.delete(IDLE_COOKIE);
    // DG7: ofis (/app) boşta kalma çerezi de aynı nedenle giriş sayfalarında düşer.
    if (path.startsWith("/giris") && request.cookies.has(APP_IDLE_COOKIE)) response.cookies.delete(APP_IDLE_COOKIE);
    return response;
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
  return applyIdlePolicy(request, response, policy.idleMinutes);
}

export const config = {
  // Kimlik-doğrulama yalnız /app, /admin, /giris, /kayit için çözülür (getUser() ağ çağrısı);
  // diğer public sayfalarda yalnız bakım modu bayrağı (30 sn bellek önbellekli) okunur.
  // API (cron, webhook, health), _next ve uzantılı statik dosyalar proxy dışındadır; tek istisna /api/admin
  // (yalnız AD11 IP izin listesi kapısı).
  matcher: ["/((?!api/|_next/|.*\\..*).*)", "/api/admin/:path*"],
};
