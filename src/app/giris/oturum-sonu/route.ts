import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TWO_FACTOR_COOKIE } from "@/lib/two-factor";
import { IDLE_COOKIE } from "@/lib/platform-security/admin-access";
import { logPlatformActivity } from "@/lib/platform-activity";

/**
 * AD11: yönetim oturumu boşta kalma (`neden=bosta`, proxy) ya da oturum ömrü (`neden=sure`, `requirePlatformStaff`)
 * nedeniyle kapanır. Yalnız BU cihazın oturumu kapatılır (scope local); diğer cihazlar etkilenmez.
 * Sonra giriş sayfasına /admin dönüşüyle yönlendirir.
 */
export async function GET(request: NextRequest) {
  const reason = request.nextUrl.searchParams.get("neden") === "sure" ? "sure" : "bosta";
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  if (userId) {
    await logPlatformActivity({
      actorId: null,
      action: reason === "sure" ? "platform.session.max_age" : "platform.session.idle_timeout",
      entityType: "auth_session",
      meta: { user_id: userId, reason },
    });
    await supabase.auth.signOut({ scope: "local" });
  }
  const jar = await cookies();
  jar.delete(TWO_FACTOR_COOKIE);
  jar.delete(IDLE_COOKIE);
  const url = request.nextUrl.clone();
  url.pathname = "/giris";
  url.search = "";
  url.searchParams.set("next", "/admin");
  return NextResponse.redirect(url);
}
