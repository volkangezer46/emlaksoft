import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { checkRateLimit } from "@/lib/rate-limit";
import { isSameOriginBridgeRequest } from "@/lib/listing-control/worker/bridge-request";
import { now, trDayKey } from "@/lib/clock";
import { log } from "@/lib/log";
import { extractWithAi, readReceiptSettings, readStoredExtraction } from "@/lib/finance/receipt/engine/service";
import { toLegacySuggestion } from "@/lib/finance/receipt/validate";
import type { LegacySuggestion, ReceiptExtraction } from "@/lib/finance/receipt/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * FİŞ OKUMA — YAPAY ZEKÂ TURU (isteğe bağlı, AYRI onay). JSON: `{ id }` (yüklenmiş ek). Döner: `{ ok, extraction, ocr }`.
 *
 * - Kapı: `expenses:create` + aynı köken + özel başlık + kullanıcı başına dakikada 10 istek.
 * - Yalnız `finance_settings.ocr_enabled` VE `ocr_ai_enabled` açıkken, anahtar tanımlıyken ve kota açıkken dış çağrı yapılır;
 *   aksi hâlde saklanan (yerel) sonuç aynen döner (`ai: "off" | "unavailable"`).
 * - Dosya OTURUMLU istemciyle okunur (RLS); service_role yok. Sonuç YALNIZ ÖNERİ; kayıt açılmaz. İçerik loglanmaz.
 */

const NO_STORE = { "Cache-Control": "no-store, max-age=0" } as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "expense-receipts";
const MAX_BYTES = 10 * 1024 * 1024;

type Body = { ok: true; extraction: ReceiptExtraction | null; ocr?: LegacySuggestion } | { ok: false; error: string };

function fail(error: string, status: number) {
  return NextResponse.json<Body>({ ok: false, error }, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  if (!isSameOriginBridgeRequest(request)) return fail("İstek doğrulanamadı. Sayfayı yenileyip tekrar deneyin.", 403);
  const gate = await requirePermission("expenses", "create");
  if (!gate.ok) return fail(gate.error, 403);
  const limit = await checkRateLimit(`fin-belge-oku:${gate.userId}`, { limit: 10, windowSec: 60, failurePolicy: "deny" });
  if (!limit.allowed) return fail("Çok sık okuma istendi. Bir dakika sonra tekrar deneyin.", 429);

  let id = "";
  try {
    const body = (await request.json()) as { id?: unknown };
    id = typeof body.id === "string" ? body.id.trim() : "";
  } catch {
    return fail("İstek okunamadı.", 400);
  }
  if (!UUID_RE.test(id)) return fail("Belge bulunamadı.", 404);

  const supabase = await createClient();
  const settings = await readReceiptSettings(supabase, gate.tenantId);
  if (!settings.enabled) return fail("Fiş okuma kapalı. Muhasebe ayarlarından açabilirsiniz.", 409);

  const row = await supabase.from("finance_attachments").select("id, storage_path, file_type, file_size, extraction").eq("id", id).maybeSingle();
  if (row.error || !row.data) return fail("Belge bulunamadı.", 404);
  const att = row.data as { storage_path: string; file_type: string | null; file_size: number | null; extraction: unknown };
  const stored = readStoredExtraction(att.extraction);
  const type = att.file_type ?? "";

  // Yapay zekâ kapalı / tanımsız ya da XML (kesin katman yeterli): saklanan sonuç döner, dış çağrı yok.
  if (!settings.aiEnabled || !settings.aiConfigured || type === "application/xml") {
    const extraction = stored ? { ...stored, ai: settings.aiEnabled ? ("unavailable" as const) : ("off" as const) } : null;
    return NextResponse.json<Body>({ ok: true, extraction, ocr: extraction ? toLegacySuggestion(extraction.fields) : undefined }, { headers: NO_STORE });
  }
  if ((att.file_size ?? 0) > MAX_BYTES || !att.storage_path.startsWith(`${gate.tenantId}/ledger/`)) return fail("Belge okunamadı.", 400);

  const file = await supabase.storage.from(BUCKET).download(att.storage_path);
  if (file.error || !file.data) return fail("Belge dosyası okunamadı.", 404);
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  try {
    const extraction = await extractWithAi({
      supabase,
      tenantId: gate.tenantId,
      userId: gate.userId,
      attachmentId: id,
      type,
      bytes,
      stored,
      todayIso: trDayKey(),
      nowIso: new Date(now()).toISOString(),
    });
    return NextResponse.json<Body>({ ok: true, extraction, ocr: toLegacySuggestion(extraction.fields) }, { headers: NO_STORE });
  } catch (e) {
    log.error("finans_belge_ai_failed", { route: "/api/app/finans/belge/oku", kind: e instanceof Error ? e.name : "unknown" });
    return fail("Okuma tamamlanamadı. Alanları elle doldurabilirsiniz.", 500);
  }
}
