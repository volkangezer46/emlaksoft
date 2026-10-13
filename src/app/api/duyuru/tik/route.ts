import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIpFromHeaders } from "@/lib/public-request-security";
import { getBaseUrl } from "@/lib/base-url";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Yalnız uygulama içi yol ya da https adresi; diğer her şey panele döner (açık yönlendirme yok). */
function safeTarget(href: string | null | undefined, origin: string): URL {
  const h = (href ?? "").trim();
  if (/^\/[^/\\]/.test(h)) return new URL(h, origin);
  if (/^https:\/\//i.test(h)) {
    try {
      return new URL(h);
    } catch {
      /* düşer */
    }
  }
  return new URL("/app", origin);
}

/**
 * Duyuru tıklama ölçümü (AD8): bildirim ve e-postadaki bağlantı buradan geçer. Teslim kimliği (rastgele UUID) bir
 * yetenek anahtarıdır; yalnız o teslimin İLK tıklamasını işaretler ve duyurunun KENDİ bağlantısına yönlendirir
 * (hedef sorgu parametresinden alınmaz). Ön yükleme (Next Link prefetch / tarayıcı spekülasyonu) tıklama sayılmaz.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("d") ?? "";
  // Konteyner arkasında req.nextUrl.origin iç adres olabilir: yönlendirme kökü tek kaynaktan.
  const origin = getBaseUrl();
  const prefetch =
    req.headers.get("next-router-prefetch") === "1"
    || /prefetch/i.test(req.headers.get("sec-purpose") ?? "")
    || /prefetch/i.test(req.headers.get("purpose") ?? "");
  if (!UUID_RE.test(id)) return NextResponse.redirect(new URL("/app", origin), 303);
  if (prefetch) return new NextResponse(null, { status: 204 });

  const ip = clientIpFromHeaders(req.headers);
  const rl = await checkRateLimit(`duyuru-tik:${ip}`, { limit: 120, windowSec: 60, failurePolicy: "allow" });
  if (!rl.allowed) return NextResponse.redirect(new URL("/app", origin), 303);

  let href: string | null = null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("platform_announcement_track_click", { p_delivery: id });
    if (!error && typeof data === "string") href = data;
  } catch (e) {
    console.error("duyuru tıklama", e instanceof Error ? e.message : e);
  }
  return NextResponse.redirect(safeTarget(href, origin), 303);
}
