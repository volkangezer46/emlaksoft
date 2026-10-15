import { NextResponse, type NextRequest } from "next/server";
import { now } from "@/lib/clock";
import { immutableReadonlyPermissions } from "@/lib/permissions-effective";
import { createAdminClient } from "@/lib/supabase/admin";
import { TV_COOKIE, resolveTvDevice } from "@/lib/tv/device";
import { loadTvData } from "@/lib/tv/tv-data";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex" } as const;
/** İzleyici kimliği yok: cihaz kimse adına okumaz (kişisel kazanç satırı hiçbir koşulda açılmaz). */
const NO_VIEWER = "00000000-0000-0000-0000-000000000000";

/**
 * Eşleşmiş ofis TV'si veri ucu (OA6). Çerezdeki cihaz sırrı etkin bir cihaza ve yayında bir ofise çözülmezse 401
 * (TV eşleştirme ekranına döner). Veri oturumlu panoyla AYNI yükleyiciden gelir (`loadTvData`: müşteri adı kısaltılmış,
 * telefon/e-posta yok, olay akışı sabit etiket) ve her sorgu cihazın kiracısına kilitlidir; gelir/komisyon cihazda
 * HİÇBİR koşulda açılmaz (salt okunur izin tavanı + gelir isteği kapalı).
 */
export async function GET(request: NextRequest) {
  const nowMs = now();
  const device = await resolveTvDevice(request.cookies.get(TV_COOKIE)?.value, { touch: true, nowMs });
  if (!device) return NextResponse.json({ error: "device" }, { status: 401, headers: NO_STORE });
  const data = await loadTvData(createAdminClient(), {
    viewer: { userId: NO_VIEWER, role: "owner", perms: immutableReadonlyPermissions() },
    tenantId: device.tenantId,
    revenueRequested: false,
    nowMs,
  });
  return NextResponse.json(data, { headers: NO_STORE });
}
