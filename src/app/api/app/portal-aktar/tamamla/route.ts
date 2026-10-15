import { CURRENT_PORTALS } from "@/lib/portals/catalog";
import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/listing-control/server/db";
import { getAdapter } from "@/lib/listing-control/adapters";
import { isPlausibleExternalId } from "@/lib/listing-control/inventory-import";
import { guardBridgeRequest, NO_STORE } from "@/lib/portal-transfer/bridge-guard";
import { completeOutcomeMessage } from "@/lib/portal-transfer/complete";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

const MAX_BODY = 20_000;

const bodySchema = z.object({
  sessionId: z.string().uuid(),
  state: z.enum(["filled", "published", "failed"]),
  portal: z.enum(CURRENT_PORTALS),
  externalId: z.string().max(40).nullish(),
  url: z.string().max(2048).nullish(),
  /** Alan başına durum (dolduruldu / bulunamadı / seçenek yok). Değer içermez, yalnız durum ve etiket. */
  report: z.record(z.string().max(40), z.string().max(40)).optional(),
});

/**
 * POST /api/app/portal-aktar/tamamla — kullanıcı portalda "Yayınla"ya bastıktan sonra eklentinin okuduğu (ya da kullanıcının
 * yapıştırdığı) ilan no ve URL'yi portföye BAĞLAR: `pt_complete_session` → `lc_bind_portal_listing(source 'assisted')`. Aynı ilan
 * no başka portföye bağlıysa reddedilir (`bound_to_other_property`). `filled`/`failed` yalnız ilerleme/ölçümdür, bağlama yapmaz.
 */
export async function POST(request: Request) {
  const guard = await guardBridgeRequest(request, { rateKey: "pt-tamamla", limit: 30, permissions: [["portals", "edit"]] });
  if (!guard.ok) return guard.response;

  let body: z.infer<typeof bodySchema>;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return NextResponse.json({ ok: false, error: "too_large" }, { status: 413, headers: NO_STORE });
    body = bodySchema.parse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400, headers: NO_STORE });
  }

  let externalId: string | null = null;
  let url: string | null = null;
  if (body.state === "published") {
    const adapter = getAdapter(body.portal);
    const n = adapter?.normalize({ url: body.url ?? null, externalId: body.externalId ?? null }) ?? null;
    if (!n || !isPlausibleExternalId(body.portal, n.externalId)) {
      return NextResponse.json({ ok: false, error: "invalid_listing_no", message: "İlan numarası (6-12 haneli) ya da portal ilan bağlantısı geçersiz." }, { status: 400, headers: NO_STORE });
    }
    externalId = n.externalId;
    url = n.url;
  }

  // B8: boş/eksik rapor null gider → SQL `coalesce(p_field_report, field_report)` önceki "filled" raporunu korur
  // ({} null olmadığı için eskisinin üstüne yazıyordu).
  const fieldReport = body.report && Object.keys(body.report).length > 0 ? body.report : null;
  const db = await createClient();
  const { data, error } = await db.rpc("pt_complete_session", {
    p_session_id: body.sessionId,
    p_state: body.state,
    p_external_id: externalId,
    p_url: url,
    p_field_report: fieldReport,
  });
  if (error) {
    log.error("portal_aktar_complete_session_failed", { route: "/api/app/portal-aktar/tamamla", code: error.code });
    return NextResponse.json({ ok: false, error: isMissingSchema(error) ? "schema_pending" : "rpc_error" }, { status: 502, headers: NO_STORE });
  }
  const outcome = String((data as { outcome?: string } | null)?.outcome ?? "");
  if (outcome !== "ok" && outcome !== "replay") {
    const status = outcome === "forbidden" ? 403 : outcome === "bound_to_other_property" ? 409 : 400;
    return NextResponse.json({ ok: false, error: outcome, message: completeOutcomeMessage(outcome) }, { status, headers: NO_STORE });
  }
  if (body.state === "published") {
    revalidatePath("/app/ilan-kontrol/portallar");
    revalidatePath("/app/portfoyler");
    revalidatePath("/app/ilan-kontrol");
  }
  return NextResponse.json({ ok: true, outcome, message: body.state === "published" ? "İlan portföye bağlandı." : "Kaydedildi." }, { headers: NO_STORE });
}
