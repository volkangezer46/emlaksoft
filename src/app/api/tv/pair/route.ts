import { NextResponse, type NextRequest } from "next/server";
import { now } from "@/lib/clock";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIpFromHeaders } from "@/lib/public-request-security";
import { TV_COOKIE, TV_COOKIE_MAX_AGE, createPairing, pairStateFor } from "@/lib/tv/device";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex" } as const;

/**
 * TV eşleştirme ucu (OA6, oturumsuz). GET: bu tarayıcının durumu (eşleşti / bekleyen kod / yok). POST: yeni kod üretir,
 * cihaz sırrını httpOnly çereze yazar. IP başına 10 dakikada en çok 10 kod (kötüye kullanım ve kod taraması sınırı).
 * Kod tek başına veri vermez: yalnız ofis yöneticisi Pano TV'den girince cihaz o ofise bağlanır.
 */
export async function GET(request: NextRequest) {
  const state = await pairStateFor(request.cookies.get(TV_COOKIE)?.value, now());
  return NextResponse.json(state, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const ip = clientIpFromHeaders(request.headers);
  const rate = await checkRateLimit(`tv-pair:${ip}`, { limit: 10, windowSec: 600, failurePolicy: "deny" });
  if (!rate.allowed) return NextResponse.json({ state: "limited" }, { status: 429, headers: NO_STORE });
  const pairing = await createPairing(now());
  if (!pairing) return NextResponse.json({ state: "unavailable" }, { status: 503, headers: NO_STORE });
  const res = NextResponse.json({ state: "pending", code: pairing.code, expiresAt: pairing.expiresAt }, { headers: NO_STORE });
  res.cookies.set(TV_COOKIE, pairing.secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TV_COOKIE_MAX_AGE,
  });
  return res;
}
