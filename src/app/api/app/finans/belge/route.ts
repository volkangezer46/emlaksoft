import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { checkRateLimit } from "@/lib/rate-limit";
import { isSameOriginBridgeRequest } from "@/lib/listing-control/worker/bridge-request";
import { canonicalExtensionForMime, normalizeUploadedFileName, verifyDocumentFile } from "@/lib/file-validation";
import { trDayKey } from "@/lib/clock";
import { safeObjectName, type ReceiptSuggestion } from "@/lib/finance/ocr/parse-receipt";
import { isReceiptOcrEnabled, readReceipt } from "@/lib/finance/ocr/receipt-ocr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MUHASEBE > BELGELER YÜKLEME UCU (FN5). Multipart: `file` (zorunlu), isteğe bağlı `entryId` / `openItemId`.
 * Döner: `{ ok: true, id, ocr? }` ya da `{ ok: false, error }` (Türkçe).
 *
 * - Kapı: `expenses:create` (aktif ofis) + aynı köken + özel başlık (CSRF) + kullanıcı başına dakikada 40 yükleme.
 * - Dosya: JPEG/PNG/WEBP/PDF, en çok 10 MB; tür bayt imzasıyla doğrulanır (`verifyDocumentFile`).
 * - Yazım: OTURUMLU istemciyle 'expense-receipts' kovasına `{tenant}/ledger/{uuid}-{ad}` (storage politikası
 *   20261013008400 yalnız kendi ofis önekine izin verir; service_role YOK), ardından `finance_attachment_register` RPC.
 *   Kayıt başarısızsa nesne geri silinir.
 * - Fiş okuma yalnız `finance_settings.ocr_enabled` açıksa; sonuç yalnız ÖNERİ (kayıt oluşturmaz).
 * Dosya adı ve içeriği loglanmaz.
 */

const NO_STORE = { "Cache-Control": "no-store, max-age=0" } as const;
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "expense-receipts";

type Body = { ok: true; id: string; ocr?: ReceiptSuggestion } | { ok: false; error: string };

function fail(error: string, status: number, extra?: Record<string, string>) {
  return NextResponse.json<Body>({ ok: false, error }, { status, headers: { ...NO_STORE, ...extra } });
}

function optionalUuid(v: FormDataEntryValue | null): string | null | false {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  return UUID_RE.test(s) ? s : false;
}

function registerError(error: { code?: string; message?: string }): string {
  const msg = error.message ?? "";
  if (error.code === "PGRST202" || error.code === "42883" || error.code === "42P01") return "Belgeler henüz etkin değil (veritabanı güncellemesi bekleniyor).";
  if (msg.includes("DONEM_KILITLI")) return "Bu ay kapatılmış (dönem kilidi). Belge kilitli aydaki bir kayda bağlanamaz.";
  if (error.code === "42501") return "Belge yüklemek için yetkiniz yok.";
  return "Belge kaydedilemedi. Sayfayı yenileyip yeniden deneyin.";
}

export async function POST(request: Request) {
  if (!isSameOriginBridgeRequest(request)) return fail("İstek doğrulanamadı. Sayfayı yenileyip tekrar deneyin.", 403);
  const gate = await requirePermission("expenses", "create");
  if (!gate.ok) return fail(gate.error, 403);
  const limit = await checkRateLimit(`fin-belge:${gate.userId}`, { limit: 40, windowSec: 60, failurePolicy: "deny" });
  if (!limit.allowed) return fail("Çok sık yükleme yapıldı. Bir dakika sonra tekrar deneyin.", 429, { "Retry-After": "60" });

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES + 64 * 1024) return fail("Dosya en çok 10 MB olabilir.", 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("Dosya okunamadı. Tekrar deneyin.", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size <= 0) return fail("Yüklenecek dosyayı seçin.", 400);
  if (file.size > MAX_BYTES) return fail("Dosya en çok 10 MB olabilir.", 413);
  if (!(ALLOWED as readonly string[]).includes(file.type)) return fail("Yalnız JPEG, PNG, WEBP görsel ya da PDF yüklenebilir.", 415);
  const entryId = optionalUuid(form.get("entryId"));
  const openItemId = optionalUuid(form.get("openItemId"));
  if (entryId === false || openItemId === false) return fail("Bağlanacak kayıt bulunamadı.", 400);

  const verified = await verifyDocumentFile(file, ALLOWED);
  if (!verified.ok) return fail(`Dosya kabul edilmedi: ${verified.error}`, 415);
  const type = verified.type;
  const ext = canonicalExtensionForMime(type);
  const displayName = normalizeUploadedFileName(file.name, type);
  const path = `${gate.tenantId}/ledger/${randomUUID()}-${safeObjectName(file.name, ext)}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const supabase = await createClient();
  const up = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: type, upsert: false, cacheControl: "0" });
  if (up.error) {
    console.error("finans belge upload", { status: (up.error as { statusCode?: string }).statusCode ?? null });
    return fail("Dosya kaydedilemedi. Belgeler henüz etkin olmayabilir; biraz sonra yeniden deneyin.", 500);
  }

  const { data, error } = await supabase.rpc("finance_attachment_register", {
    p_storage_path: path,
    p_file_name: displayName,
    p_file_type: type,
    p_file_size: file.size,
    p_entry_id: entryId,
    p_open_item_id: openItemId,
  });
  if (error || typeof data !== "string") {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => undefined);
    if (error) console.error("finans belge register", { code: error.code ?? null });
    return fail(error ? registerError(error) : "Belge kaydedilemedi. Sayfayı yenileyip yeniden deneyin.", error?.code === "42501" ? 403 : 500);
  }
  const id = data;

  let ocr: ReceiptSuggestion | undefined;
  const enabled = await isReceiptOcrEnabled(supabase, gate.tenantId);
  if (enabled) {
    const outcome = await readReceipt({ enabled, tenantId: gate.tenantId, userId: gate.userId, fileType: type, bytes, todayIso: trDayKey() });
    if (outcome.status === "done") {
      ocr = outcome.suggestion;
      await supabase.rpc("finance_attachment_set_ocr", { p_id: id, p_status: "done", p_json: outcome.suggestion });
    } else if (outcome.status === "failed") {
      await supabase.rpc("finance_attachment_set_ocr", { p_id: id, p_status: "failed", p_json: null });
    }
  }

  revalidatePath("/app/giderler");
  return NextResponse.json<Body>(ocr ? { ok: true, id, ocr } : { ok: true, id }, { headers: NO_STORE });
}
