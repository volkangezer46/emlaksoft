import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import {
  buildContentDisposition,
  isSafeTenantObjectPath,
  normalizeDocumentMime,
  normalizeDownloadFileName,
  verifyDocumentFile,
  type DetectedDocument,
} from "@/lib/file-validation";

/**
 * Gider fişi indirme/önizleme (20261007000700). Desen: `src/app/api/customer-files/[id]/download/route.ts`.
 * Meta satırı OTURUMLU istemciyle (RLS: giderler:görüntüle + kendi ofisi) okunur; özel kovadan bayt yalnız bu
 * satır bulunup yol tenant/gider önekiyle doğrulandıktan sonra service_role ile indirilir.
 */
const SAFE_INLINE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_INLINE_BYTES = 10 * 1024 * 1024;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notFoundResponse() {
  return NextResponse.json({ error: "Dosya bulunamadı" }, { status: 404 });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requirePermission("expenses", "view");
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: 403 });

  const { id } = await params;
  if (!UUID_RE.test(id)) return notFoundResponse();
  const supabase = await createClient();
  const { data: file, error: fileError } = await supabase
    .from("expense_receipt_files")
    .select("expense_id, file_name, file_type, storage_path")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (fileError) {
    console.error("expense receipt lookup failed", { code: fileError.code });
    return notFoundResponse();
  }
  if (!file || !isSafeTenantObjectPath(file.storage_path, gate.tenantId, file.expense_id)) {
    return notFoundResponse();
  }

  const admin = createAdminClient();
  const { data: blob, error } = await admin.storage.from("expense-receipts").download(file.storage_path);
  if (error || !blob) {
    console.error("expense receipt download failed", { statusCode: error?.statusCode });
    return notFoundResponse();
  }

  const requestedInline = new URL(req.url).searchParams.get("onizle") === "1";
  const storedType = normalizeDocumentMime(file.file_type);
  let responseNameType: DetectedDocument | null = storedType;
  let inline = false;
  let contentType = storedType && SAFE_INLINE_TYPES.has(storedType) ? storedType : "application/octet-stream";
  if (requestedInline && storedType && SAFE_INLINE_TYPES.has(storedType) && blob.size <= MAX_INLINE_BYTES) {
    const previewFile = new File([blob], file.file_name, { type: storedType });
    const verified = await verifyDocumentFile(previewFile, [storedType]);
    inline = verified.ok && verified.type === storedType;
    if (!inline) {
      contentType = "application/octet-stream";
      responseNameType = null;
    }
  } else if (requestedInline) {
    contentType = "application/octet-stream";
  }

  const safeFileName = normalizeDownloadFileName(file.file_name, responseNameType);
  return new Response(blob.stream(), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(blob.size),
      "Content-Disposition": buildContentDisposition(inline ? "inline" : "attachment", safeFileName),
      "Cache-Control": "private, no-store, max-age=0",
      "CDN-Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Download-Options": "noopen",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
    },
  });
}
