import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { importPortalInventory } from "@/app/actions/listing-control-inventory";
import { workerReportParser } from "@/app/actions/listing-control-worker";
import { isSameOriginBridgeRequest } from "@/lib/listing-control/worker/bridge-request";
import { sanitizeUpload, UPLOAD_LIMITS, type ValidUpload } from "@/lib/listing-control/worker/extension-scan";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" } as const;

/**
 * GÜNLÜK MAĞAZA TARAMASI YÜKLEME UCU. Eklentinin içerik betiği (yalnız EmlakSoft sayfasında) kullanıcının AÇIK OTURUMUYLA aynı
 * kökenden çağırır; ofisin kendi "ilanlarım" listesi tarayıcıda okunmuş ve gönderilmiştir. Sunucu portala istek ATMAZ. İş
 * `importPortalInventory`'ye devredilir: `requirePermission("portals","edit")` + JWT kimlikli `lc_inventory_import` RPC'si
 * (service_role YOK). Tamlık YALNIZ sunucuda yeniden hesaplanır (`sanitizeUpload`): toplam ilan sayısı okunmadan "liste tam" sayılmaz.
 * CSRF: aynı köken + özel başlık (`x-emlaksoft-bridge: 1`).
 */
export async function POST(request: Request) {
  if (!isSameOriginBridgeRequest(request)) return NextResponse.json({ ok: false, error: "origin" }, { status: 403, headers: NO_STORE });
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ ok: false, error: "session" }, { status: 401, headers: NO_STORE });

  let up: ValidUpload | null;
  try {
    const raw = await request.text();
    if (raw.length > UPLOAD_LIMITS.maxBody) return NextResponse.json({ ok: false, error: "too_large" }, { status: 413, headers: NO_STORE });
    up = sanitizeUpload(JSON.parse(raw));
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400, headers: NO_STORE });
  }
  if (!up) return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400, headers: NO_STORE });

  // Ayrıştırıcı sayacı (en iyi çaba, kişisel veri yok): okunamayan yapı "ayrıştırılamadı" olarak sayılır.
  if (up.parserVersion) {
    const unreadable = up.kind === "unreadable";
    await workerReportParser({
      portal: up.portal,
      parserVersion: up.parserVersion,
      classification: unreadable ? "unknown" : "live",
      layer: null,
      errorCode: unreadable ? "store_unparsed" : null,
      partial: up.kind === "partial",
    }).catch(() => null);
  }
  if (up.items.length === 0) return NextResponse.json({ ok: true, outcome: "telemetry_only" }, { headers: NO_STORE });

  const res = await importPortalInventory({
    portal: up.portal,
    scope: "auto",
    source: "extension",
    complete: up.complete,
    items: up.items,
    expectedCount: up.expected,
    readCount: up.read,
  });
  if (!res.ok) {
    // Geçici (sistem güncellemesi bekleniyor / okuma hatası) → eklenti yeniden dener; yetki → bırakır.
    const forbidden = /yetki/i.test(res.error);
    return NextResponse.json({ ok: false, error: forbidden ? "forbidden" : "rpc_error" }, { status: forbidden ? 403 : 502, headers: NO_STORE });
  }
  return NextResponse.json({ ok: true, outcome: "applied", complete: res.complete, applied: res.applied, registered: res.registered, opened: res.opened }, { headers: NO_STORE });
}
