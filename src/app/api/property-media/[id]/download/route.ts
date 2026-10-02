import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import {
  buildContentDisposition,
  isSafeTenantObjectPath,
  normalizeDocumentMime,
  normalizeDownloadFileName,
} from "@/lib/file-validation";

const SAFE_INLINE_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export const dynamic = "force-dynamic";

/**
 * Portföy medyasının YETKİLİ servis ucu — Belge Merkezi (/app/belgeler) için.
 *
 * Neden ayrı uç: kardeş rota `/api/property-media/[id]` bilinçli olarak PUBLIC'tir
 * (vitrin/paylaşım galerileri) ve yalnız yayındaki, silinmemiş portföylerin
 * GÖRSELLERİNİ servis eder. Belge Merkezi ise taslak portföylerin fotoğraflarını,
 * video/tur dosyalarını ve PDF'leri de listeler; oradaki `status !== 'draft'`
 * kapısı bu satırları görünmez yapardı.
 *
 * Bu uç public DEĞİL: `properties:view` izni + satırın tenant doğrulaması
 * (RLS'li kullanıcı istemcisiyle okunur, storage indirmesi admin client ile
 * yapılır çünkü bucket private).
 *
 * ?indir=1 → attachment (indirme), aksi halde inline (önizleme/lightbox).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission("properties", "view");
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: 403 });

  const { id } = await params;
  const supabase = await createClient();

  // RLS + açık tenant eşitliği: kimlik doğrulanmış ama başka ofisteki bir
  // kullanıcı, id'yi tahmin etse bile satıra ulaşamaz.
  const { data: media } = await supabase
    .from("property_media")
    .select("property_id, storage_path, file_name, file_type")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (
    !media?.storage_path ||
    !isSafeTenantObjectPath(media.storage_path, gate.tenantId, media.property_id)
  ) {
    return NextResponse.json({ error: "Dosya bulunamadı" }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data: blob, error } = await admin.storage.from("property-media").download(media.storage_path);
  if (error || !blob) {
    console.error("property-media download", error);
    return NextResponse.json({ error: "İndirme başarısız" }, { status: 500 });
  }

  const url = new URL(req.url);
  const asAttachment = url.searchParams.get("indir") === "1";
  const storedType = normalizeDocumentMime(media.file_type);
  const safeInline = storedType !== null && SAFE_INLINE_TYPES.has(storedType);
  const disposition = asAttachment || !safeInline ? "attachment" : "inline";
  const contentType = safeInline && storedType ? storedType : "application/octet-stream";
  const name = normalizeDownloadFileName(media.file_name || `medya-${id}`, storedType);

  return new Response(blob.stream(), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(blob.size),
      "Content-Disposition": buildContentDisposition(disposition, name),
      // Yetkili içerik — ara katman/CDN önbelleğe almasın.
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
