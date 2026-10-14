import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { publicRedirect } from "@/lib/public-redirect";
import { createClient } from "@/lib/supabase/server";
import { TWO_FACTOR_COOKIE } from "@/lib/two-factor";
import { IDLE_COOKIE } from "@/lib/platform-security/admin-access";
import { logPlatformActivity } from "@/lib/platform-activity";

/**
 * AD11: yönetim oturumu boşta kalma (`neden=bosta`, proxy) ya da oturum ömrü (`neden=sure`, `requirePlatformStaff`)
 * nedeniyle kapanır. Yalnız BU cihazın oturumu kapatılır (scope local); diğer cihazlar etkilenmez.
 * Yalnız AKTİF platform personeli için çalışır: ofis kullanıcısı (ya da oturumsuz ziyaretçi) bu adrese gelirse
 * oturumuna dokunulmaz ve append-only denetim izine satır yazılmaz; doğrudan girişe yönlenir. Böylece dış bir
 * bağlantı ofis kullanıcılarını çıkışa zorlayamaz ve denetim izi yanıltıcı kayıtla dolmaz. (GET kalır: proxy
 * yönlendirmesi çapraz siteden gelen gezinmede de çalışmalı; personel için etkisi yalnız yeniden giriştir.)
 */
export async function GET(request: NextRequest) {
  const reason = request.nextUrl.searchParams.get("neden") === "sure" ? "sure" : "bosta";
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  const isStaff = userId
    ? Boolean(
        (await supabase.from("platform_staff").select("id").eq("id", userId).eq("is_active", true).maybeSingle()).data,
      )
    : false;
  if (userId && isStaff) {
    await logPlatformActivity({
      actorId: userId,
      action: reason === "sure" ? "platform.session.max_age" : "platform.session.idle_timeout",
      entityType: "auth_session",
      meta: { user_id: userId, reason },
    });
    await supabase.auth.signOut({ scope: "local" });
  }
  const jar = await cookies();
  jar.delete(IDLE_COOKIE);
  if (isStaff) jar.delete(TWO_FACTOR_COOKIE);
  // Kök getBaseUrl'den (istekten kurulan adres ters vekil arkasında 0.0.0.0:3000 olur).
  return publicRedirect(isStaff ? "/giris?next=%2Fadmin" : "/giris");
}
