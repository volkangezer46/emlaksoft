import { financePath } from "@/lib/finance/routes";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { checkRateLimit } from "@/lib/rate-limit";
import { isSameOriginBridgeRequest } from "@/lib/listing-control/worker/bridge-request";
import { canonicalExtensionForMime, normalizeUploadedFileName, verifyDocumentFile } from "@/lib/file-validation";
import { now, trDayKey } from "@/lib/clock";
import { safeObjectName } from "@/lib/finance/ocr/parse-receipt";
import { extractOnUpload, readReceiptSettings } from "@/lib/finance/receipt/engine/service";
import { sniffXml, UBL_MAX_BYTES } from "@/lib/finance/receipt/ubl";
import { toLegacySuggestion } from "@/lib/finance/receipt/validate";
import type { LegacySuggestion, ReceiptExtraction } from "@/lib/finance/receipt/types";
import { financeAttachmentErrorMessage } from "@/lib/finance/attachment-errors";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MUHASEBE > BELGELER YÜKLEME UCU (FN5). Multipart: `file` (zorunlu), isteğe bağlı `entryId` / `openItemId`.
 * Döner: `{ ok: true, id, ocr? }` ya da `{ ok: false, error }` (Türkçe).
 *
 * - Kapı: `expenses:create` (aktif ofis) + aynı köken + özel başlık (CSRF) + kullanıcı başına dakikada 40 yükleme.
 * - Dosya: JPEG/PNG/WEBP/PDF, en çok 10 MB; tür bayt imzasıyla doğrulanır (`verifyDocumentFile`). e-Fatura XML (UBL-TR,
 *   en çok 5 MB) içerik imzasıyla doğrulanır (DOCTYPE/ENTITY reddedilir) ve kovaya betik çalıştıramayan `text/plain` olarak yazılır.
 * - Yazım: OTURUMLU istemciyle 'expense-receipts' kovasına `{tenant}/ledger/{uuid}-{ad}` (storage politikası
 *   20261013008400 yalnız kendi ofis önekine izin verir; service_role YOK), ardından `finance_attachment_register` RPC.
 *   Kayıt başarısızsa nesne geri silinir: silme politikası, aynı kullanıcının son 15 dakikada yüklediği ve
 *   `finance_attachments`'ta karşılığı OLMAYAN nesneye `expenses:create` ile de izin verir (yalnız create yetkili
 *   kullanıcıda yetim nesne kalmaz).
 * - Fiş okuma yalnız `finance_settings.ocr_enabled` açıksa (varsayılan KAPALI): yerel katmanlar (karekod, XML, PDF metni,
 *   yerel OCR; dosya sunucudan çıkmaz) çalışır, sonuç `extraction` (alan + güven + kaynak + uyarılar) ve eski biçim `ocr`
 *   olarak döner. Yapay zekâ burada çağrılmaz (ayrı uç: `/api/app/finans/belge/oku`, ayrı onay). Sonuç YALNIZ ÖNERİ.
 * Dosya adı ve içeriği loglanmaz.
 */

const NO_STORE = { "Cache-Control": "no-store, max-age=0" } as const;
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
const XML_TYPES = new Set(["application/xml", "text/xml"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "expense-receipts";

type Body = { ok: true; id: string; ocr?: LegacySuggestion; extraction?: ReceiptExtraction } | { ok: false; error: string };

function fail(error: string, status: number, extra?: Record<string, string>) {
  return NextResponse.json<Body>({ ok: false, error }, { status, headers: { ...NO_STORE, ...extra } });
}

function optionalUuid(v: FormDataEntryValue | null): string | null | false {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  return UUID_RE.test(s) ? s : false;
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
  const claimedXml = XML_TYPES.has(file.type) || (/\.xml$/i.test(file.name) && (!file.type || file.type === "application/octet-stream"));
  if (!claimedXml && !(ALLOWED as readonly string[]).includes(file.type)) return fail("Yalnız JPEG, PNG, WEBP görsel, PDF ya da e-Fatura XML yüklenebilir.", 415);
  const entryId = optionalUuid(form.get("entryId"));
  const openItemId = optionalUuid(form.get("openItemId"));
  if (entryId === false || openItemId === false) return fail("Bağlanacak kayıt bulunamadı.", 400);

  let type: string;
  let ext: string;
  let displayName: string;
  let bytes: Uint8Array;
  if (claimedXml) {
    if (file.size > UBL_MAX_BYTES) return fail("XML dosyası en çok 5 MB olabilir.", 413);
    bytes = new Uint8Array(await file.arrayBuffer());
    const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 4096));
    if (!sniffXml(bytes) || /<!DOCTYPE|<!ENTITY/i.test(head) || !/Invoice|CreditNote/.test(head)) return fail("Dosya kabul edilmedi: yalnız e-Fatura / e-Arşiv (UBL-TR) XML yüklenebilir.", 415);
    type = "application/xml";
    ext = "xml";
    displayName = normalizeUploadedFileName(file.name, "application/pdf").replace(/\.pdf$/i, ".xml");
  } else {
    const verified = await verifyDocumentFile(file, ALLOWED);
    if (!verified.ok) return fail(`Dosya kabul edilmedi: ${verified.error}`, 415);
    type = verified.type;
    ext = canonicalExtensionForMime(verified.type);
    displayName = normalizeUploadedFileName(file.name, verified.type);
    bytes = new Uint8Array(await file.arrayBuffer());
  }
  const path = `${gate.tenantId}/ledger/${randomUUID()}-${safeObjectName(file.name, ext)}`;

  const supabase = await createClient();
  // XML tarayıcıda betik çalıştırabilir: kovaya düz metin türüyle yazılır.
  const up = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: type === "application/xml" ? "text/plain" : type, upsert: false, cacheControl: "0" });
  if (up.error) {
    log.error("finans_belge_upload_failed", { route: "/api/app/finans/belge", code: (up.error as { statusCode?: string }).statusCode ?? null });
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
    if (error) log.error("finans_belge_register_failed", { route: "/api/app/finans/belge", code: error.code ?? null });
    const forbidden = error?.code === "42501" || (error?.message ?? "").includes("FN:forbidden");
    return fail(error ? financeAttachmentErrorMessage(error, "Belge kaydı") : "Belge kaydedilemedi. Sayfayı yenileyip yeniden deneyin.", forbidden ? 403 : 500);
  }
  const id = data;

  let extraction: ReceiptExtraction | undefined;
  const settings = await readReceiptSettings(supabase, gate.tenantId);
  if (settings.enabled) {
    try {
      extraction = await extractOnUpload({ supabase, attachmentId: id, type, bytes, settings, todayIso: trDayKey(), nowIso: new Date(now()).toISOString() });
    } catch (e) {
      log.error("finans_belge_extract_failed", { route: "/api/app/finans/belge", kind: e instanceof Error ? e.name : "unknown" });
      await supabase.rpc("finance_attachment_set_ocr", { p_id: id, p_status: "failed", p_json: null });
    }
  }

  revalidatePath(financePath(), "layout");
  const ocr = extraction ? toLegacySuggestion(extraction.fields) : undefined;
  return NextResponse.json<Body>(extraction ? { ok: true, id, ocr, extraction } : { ok: true, id }, { headers: NO_STORE });
}
