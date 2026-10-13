import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { now as clockNow } from "@/lib/clock";
import { guardBridgeRequest, NO_STORE } from "@/lib/portal-transfer/bridge-guard";
import { EXT_VERSION_HEADER } from "@/lib/listing-control/worker/bridge-request";
import { FORM_RULES_ENGINE } from "@/lib/portal-transfer/rule-format";
import { isSupportedExtension, loadServableRuleSets, matchesIfNoneMatch } from "@/lib/portal-rules/server/serve";

export const dynamic = "force-dynamic";

/** ETag ile koşullu GET: her istekte doğrulanır (private, no-cache), içerik değişmediyse 304. */
const REVALIDATE = { "Cache-Control": "private, no-cache" } as const;

/**
 * GET /api/app/portal-aktar/kurallar?engine=f1 — eklentinin içerik betiği (yalnız EmlakSoft sayfasında; aynı köken + köprü
 * başlığı + oturum + portals/view, 30/dk) İMZALI kural setlerini alır. Sunucu burada imzalamaz: yayında üretilmiş imzayı
 * doğrulayıp sunar (serve.ts). `x-emlaksoft-ext` <0.6.0 ya da engine≠f1 → 426. Açık anahtar yoksa 503
 * `signing_unavailable` (eklenti tohumda kalır). Tablolar yoksa 200 `sets: []`.
 */
export async function GET(request: Request) {
  const guard = await guardBridgeRequest(request, { rateKey: "pt-kurallar", limit: 30, permissions: [["portals", "view"]] });
  if (!guard.ok) return guard.response;

  const engine = new URL(request.url).searchParams.get("engine");
  if (!isSupportedExtension(request.headers.get(EXT_VERSION_HEADER)) || engine !== FORM_RULES_ENGINE) {
    return NextResponse.json(
      { ok: false, error: "upgrade_required", message: "Eklentinin yeni sürümü gerekiyor." },
      { status: 426, headers: NO_STORE },
    );
  }

  const db = await createClient();
  const r = await loadServableRuleSets(db, { nowMs: clockNow() });
  switch (r.status) {
    case "signing_unavailable":
      return NextResponse.json({ ok: false, error: "signing_unavailable" }, { status: 503, headers: { ...NO_STORE, "Retry-After": "3600" } });
    case "schema_pending":
      return NextResponse.json({ engine: FORM_RULES_ENGINE, sets: [] }, { headers: NO_STORE });
    case "forbidden":
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403, headers: NO_STORE });
    case "error":
      return NextResponse.json({ ok: false, error: "rpc_error" }, { status: 502, headers: NO_STORE });
  }
  const headers = { ...REVALIDATE, ETag: r.etag };
  if (matchesIfNoneMatch(request.headers.get("if-none-match"), r.etag)) {
    return new NextResponse(null, { status: 304, headers });
  }
  return NextResponse.json({ engine: FORM_RULES_ENGINE, sets: r.sets }, { headers });
}
