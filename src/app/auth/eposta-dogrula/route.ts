import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { EMAIL_VERIFIED_META_KEY } from "@/lib/auth/email-verification";
import { daysFromNowIso } from "@/lib/clock";

/**
 * E-posta doğrulama bağlantısı dönüşü (Supabase PKCE kodu). Kod oturuma çevrilir, kullanıcı meta verisine
 * `email_verified_at` yazılır ve /app'e dönülür. Bağlantı başka tarayıcıda açılırsa (doğrulayıcı çerez yok)
 * girişe yönlendirilir. Yeni service_role kullanımı YOK.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const back = (path: string) => {
    const res = NextResponse.redirect(new URL(path, request.nextUrl.origin));
    res.headers.set("Cache-Control", "no-store");
    return res;
  };
  if (!code) return back("/app?eposta=hata");
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return back("/giris");
  const { error: updateError } = await supabase.auth.updateUser({ data: { [EMAIL_VERIFIED_META_KEY]: daysFromNowIso(0) } });
  if (updateError) {
    console.error("eposta-dogrula", updateError.message);
    return back("/app?eposta=hata");
  }
  return back("/app?eposta=dogrulandi");
}
