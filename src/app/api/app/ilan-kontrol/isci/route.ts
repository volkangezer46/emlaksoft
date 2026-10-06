import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { workerClaim, workerComplete, workerRegister, workerRelease } from "@/app/actions/listing-control-worker";
import { isSameOriginBridgeRequest } from "@/lib/listing-control/worker/bridge-request";
import { CHECK_RESULTS, type CheckResultKind } from "@/lib/listing-control/types";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" } as const;

/**
 * TARAYICI EKLENTİSİ OTOMATİK KONTROL UCU. Eklentinin içerik betiği (yalnız EmlakSoft sayfasında çalışır) kullanıcının
 * AÇIK OTURUMUYLA, aynı kökenden çağırır; her işlem mevcut işçi sunucu eylemlerine (`listing-control-worker.ts`:
 * `requirePermission("portals","edit")` + JWT kimlikli `lc_worker_*` RPC'leri) aynen devredilir: service_role YOK,
 * yeni yetki yolu YOK. CSRF: yalnız aynı köken + özel başlık (`x-emlaksoft-bridge: 1`) kabul edilir (başka sitenin
 * formu/scripti bu başlıkla aynı kökenden istek atamaz). Sunucu portala istek ATMAZ.
 */
export async function POST(request: Request) {
  if (!isSameOriginBridgeRequest(request)) return NextResponse.json({ ok: false, error: "origin" }, { status: 403, headers: NO_STORE });
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ ok: false, error: "session" }, { status: 401, headers: NO_STORE });

  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 8_192) return NextResponse.json({ ok: false, error: "too_large" }, { status: 413, headers: NO_STORE });
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400, headers: NO_STORE });
  }
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");

  switch (body.op) {
    case "register":
      return NextResponse.json(await workerRegister(str("deviceKey"), "Tarayıcı eklentisi", str("version")), { headers: NO_STORE });
    case "claim":
      return NextResponse.json(await workerClaim(str("clientId")), { headers: NO_STORE });
    case "complete": {
      const result = str("result") as CheckResultKind;
      if (!CHECK_RESULTS.includes(result)) return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400, headers: NO_STORE });
      const observed = typeof body.observed === "object" && body.observed !== null ? (body.observed as Record<string, unknown>) : {};
      return NextResponse.json(await workerComplete({ clientId: str("clientId"), jobId: str("jobId"), result, observed }), { headers: NO_STORE });
    }
    case "release":
      return NextResponse.json(await workerRelease(str("clientId"), str("jobId"), str("reason")), { headers: NO_STORE });
    default:
      return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400, headers: NO_STORE });
  }
}
