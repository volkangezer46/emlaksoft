import { NextResponse } from "next/server";
import { now } from "@/lib/clock";
import { getEffectivePermissions, immutableReadonlyPermissions } from "@/lib/permissions-effective";
import { requirePermission } from "@/lib/require-permission";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { loadTvData } from "@/lib/tv/tv-data";
import { canViewTv } from "@/lib/tv/tv-logic";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" } as const;

/**
 * Ofis Panosu (TV) canlı veri ucu. Oturumlu kullanıcı + RLS (service_role yok), yalnız ofis geneli kapsam
 * rolleri. 401 = oturum bitti (TV "yeniden giriş" ekranı gösterir), 403 = yetki/kapsam yok.
 * `?gelir=1` yalnız istektir: gelir/komisyon yine earnings_all ister.
 */
export async function GET(request: Request) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "session" }, { status: 401, headers: NO_STORE });

  const gate = await requirePermission("reports", "view");
  if (!gate.ok) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  if (!canViewTv(gate.role)) return NextResponse.json({ error: "scope" }, { status: 403, headers: NO_STORE });

  const perms = gate.impersonating ? immutableReadonlyPermissions() : await getEffectivePermissions(gate.tenantId, gate.role, gate.userId);
  const revenueRequested = new URL(request.url).searchParams.get("gelir") === "1";
  const supabase = await createClient();
  const data = await loadTvData(supabase, {
    viewer: { userId: gate.userId, role: gate.role, perms },
    tenantId: gate.tenantId,
    revenueRequested,
    nowMs: now(),
  });
  return NextResponse.json(data, { headers: NO_STORE });
}
