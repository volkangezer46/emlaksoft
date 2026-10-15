import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { now as clockNow } from "@/lib/clock";
import { isMissingSchema } from "@/lib/listing-control/server/db";
import { codeOutcomeMessage, hashTransferCode, normalizeTransferCode } from "@/lib/portal-transfer/code";
import { buildPortalPayload, readinessCheck } from "@/lib/portal-transfer/payload";
import { isTransferPortal } from "@/lib/portal-transfer/rules";
import { loadPropertyForTransfer } from "@/lib/portal-transfer/server";
import { transferWatermarkFromTenant } from "@/lib/portal-transfer/photo-watermark";
import { guardBridgeRequest, NO_STORE } from "@/lib/portal-transfer/bridge-guard";
import { authorityPublishGate } from "@/lib/eids/ledger";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

const MAX_BODY = 600;

/**
 * POST /api/app/portal-aktar/al — "Portala aktar": eklentinin içerik betiği (yalnız EmlakSoft sayfasında) kullanıcının AÇIK
 * OTURUMUYLA aynı kökenden çağırır ve aktarım kodunu TEK KULLANIMLIK tüketip portföy paketini alır. Kod: oturum sahibine
 * bağlı, kısa ömürlü; ikinci kullanım "used", süre dolmuşsa "expired" (RPC `pt_consume_code`, atomik). Paket taze okunur
 * (kullanıcı kodu aldıktan sonra portföyü değiştirdiyse güncel hali gider). Sunucu portala istek ATMAZ.
 */
export async function POST(request: Request) {
  const guard = await guardBridgeRequest(request, { rateKey: "pt-al", limit: 20, permissions: [["portals", "edit"]] });
  if (!guard.ok) return guard.response;
  const { gate } = guard;

  let code: string | null = null;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return NextResponse.json({ ok: false, error: "too_large" }, { status: 413, headers: NO_STORE });
    code = normalizeTransferCode((JSON.parse(raw) as { code?: unknown }).code);
  } catch {
    code = null;
  }
  if (!code) return NextResponse.json({ ok: false, error: "invalid_input", message: codeOutcomeMessage("invalid") }, { status: 400, headers: NO_STORE });

  const db = await createClient();
  const { data, error } = await db.rpc("pt_consume_code", { p_code_hash: hashTransferCode(code) });
  if (error) {
    log.error("portal_aktar_consume_code_failed", { route: "/api/app/portal-aktar/al", code: error.code });
    return NextResponse.json(
      { ok: false, error: isMissingSchema(error) ? "schema_pending" : "rpc_error", message: isMissingSchema(error) ? "Portala aktarma için sistem güncellemesi bekleniyor." : "Aktarım başlatılamadı." },
      { status: 502, headers: NO_STORE },
    );
  }
  const r = (data ?? {}) as { outcome?: string; session_id?: string; property_id?: string; portal?: string };
  if (r.outcome !== "ok" || !r.session_id || !r.property_id || !isTransferPortal(r.portal)) {
    const outcome = String(r.outcome ?? "invalid");
    const status = outcome === "forbidden" ? 403 : outcome === "used" || outcome === "expired" ? 410 : 404;
    return NextResponse.json({ ok: false, error: outcome, message: codeOutcomeMessage(outcome) }, { status, headers: NO_STORE });
  }

  // EİDS kapısı paket verilirken YENİDEN uygulanır: kod alındıktan sonra yetki iptal edildi / süresi dolduysa paket gitmez.
  const authGate = await authorityPublishGate(db, gate.tenantId, r.property_id);
  if (authGate.blocked) return NextResponse.json({ ok: false, error: "authority_blocked", message: authGate.error }, { status: 403, headers: NO_STORE });

  const input = await loadPropertyForTransfer(db, gate.tenantId, r.property_id);
  if (!input) return NextResponse.json({ ok: false, error: "property_not_found", message: codeOutcomeMessage("property_not_found") }, { status: 404, headers: NO_STORE });
  const payload = buildPortalPayload(input, r.portal, clockNow());
  // Ofis filigranı: yalnız kendi kiracısının ayarı (RLS + tenant eşitliği); kapalıysa null → fotoğraflar orijinal gider.
  const { data: tenant } = await db.from("tenants").select("name, logo_url, watermark_settings").eq("id", gate.tenantId).maybeSingle();
  const watermark = transferWatermarkFromTenant(tenant);
  return NextResponse.json({ ok: true, sessionId: r.session_id, payload, readiness: readinessCheck(payload), watermark }, { headers: NO_STORE });
}
