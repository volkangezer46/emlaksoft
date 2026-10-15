import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIpFromHeaders } from "@/lib/public-request-security";
import { publicRedirect, publicUrl } from "@/lib/public-redirect";
import { log } from "@/lib/log";
import { errorFields } from "@/lib/log-error";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Yönlendirme hedefi: duyurunun KENDİ bağlantısı (sorgu parametresinden alınmaz). Uygulama içi yol herkese açık
 * kökle (publicUrl → getBaseUrl) kurulur; dış hedef yalnız kimlik bilgisi taşımayan https adresi olabilir (kayıtta
 * parseHref aynı kuralı uygular). Diğer her şey panele döner — açık yönlendirme yok.
 */
function safeTarget(href: string | null | undefined): URL {
  const h = (href ?? "").trim();
  if (/^\/[^/\\]/.test(h)) return publicUrl(h);
  if (/^https:\/\//i.test(h)) {
    try {
      const u = new URL(h);
      if (u.protocol === "https:" && !u.username && !u.password) return u;
    } catch {
      /* düşer */
    }
  }
  return publicUrl("/app");
}

/**
 * Duyuru tıklama ölçümü (AD8): bildirim ve e-postadaki bağlantı buradan geçer. Teslim kimliği (rastgele UUID) bir
 * yetenek anahtarıdır; yalnız o teslimin İLK tıklamasını işaretler ve duyurunun KENDİ bağlantısına yönlendirir
 * (hedef sorgu parametresinden alınmaz). Ön yükleme (Next Link prefetch / tarayıcı spekülasyonu) tıklama sayılmaz.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("d") ?? "";
  const prefetch =
    req.headers.get("next-router-prefetch") === "1"
    || /prefetch/i.test(req.headers.get("sec-purpose") ?? "")
    || /prefetch/i.test(req.headers.get("purpose") ?? "");
  if (!UUID_RE.test(id)) return publicRedirect("/app", 303);
  if (prefetch) return new NextResponse(null, { status: 204 });

  const ip = clientIpFromHeaders(req.headers);
  const rl = await checkRateLimit(`duyuru-tik:${ip}`, { limit: 120, windowSec: 60, failurePolicy: "allow" });
  if (!rl.allowed) return publicRedirect("/app", 303);

  let href: string | null = null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("platform_announcement_track_click", { p_delivery: id });
    if (!error && typeof data === "string") href = data;
  } catch (e) {
    log.error("duyuru_tik_failed", { route: "/api/duyuru/tik", ...errorFields(e) });
  }
  return NextResponse.redirect(safeTarget(href), 303);
}
