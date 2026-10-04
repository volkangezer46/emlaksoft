import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import {
  REF_COOKIE,
  REF_COOKIE_DAYS,
  formatRefCookie,
  resolveAttributionInput,
  type RefTouch,
} from "@/lib/growth/attribution";
import { countClickSafe, recordSignupAttributionSafe } from "@/lib/growth/store";

/**
 * /r/<kod> ve /p/<kod> ortak yönlendirmesi: sayaç + birinci taraf çerez (ilk dokunuş kazanır) → /kayit.
 * Tanınmayan kod sessizce /kayit'a düşer. Kişisel veri (IP, cihaz izi) okunmaz/saklanmaz.
 */
export async function captureAndRedirect(req: NextRequest, touch: RefTouch | null): Promise<NextResponse> {
  const res = NextResponse.redirect(new URL("/kayit", req.url));
  res.headers.set("Cache-Control", "no-store");
  if (!touch) return res;
  await countClickSafe(touch.kind, touch.code);
  if (!req.cookies.get(REF_COOKIE)?.value) {
    res.cookies.set(REF_COOKIE, formatRefCookie(touch), {
      maxAge: REF_COOKIE_DAYS * 86_400,
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    });
  }
  return res;
}

/**
 * signUp sonrası TEK çağrı: form gizli alanları + çerez → ilk dokunuş atfı. ASLA fırlatmaz.
 * Çerez kullanıldıktan sonra silinir.
 */
export async function recordSignupAttributionFromRequest(tenantId: string, formData: FormData): Promise<void> {
  try {
    const jar = await cookies();
    const input = resolveAttributionInput({
      cookie: jar.get(REF_COOKIE)?.value,
      ref: String(formData.get("ref") ?? ""),
      utm_source: String(formData.get("utm_source") ?? ""),
      utm_medium: String(formData.get("utm_medium") ?? ""),
      utm_campaign: String(formData.get("utm_campaign") ?? ""),
    });
    await recordSignupAttributionSafe(tenantId, input);
    jar.delete(REF_COOKIE);
  } catch (e) {
    console.error("recordSignupAttributionFromRequest", e);
  }
}
