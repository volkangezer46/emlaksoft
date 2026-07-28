import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";

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
    .select("storage_path, file_name, file_type")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!media?.storage_path) {
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
  const name = media.file_name || `medya-${id}`;

  return new NextResponse(blob, {
    headers: {
      "Content-Type": media.file_type || "application/octet-stream",
      "Content-Disposition": `${asAttachment ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      // Yetkili içerik — ara katman/CDN önbelleğe almasın.
      "Cache-Control": "private, no-store",
    },
  });
}
