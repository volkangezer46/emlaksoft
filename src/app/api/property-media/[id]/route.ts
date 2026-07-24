import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: media } = await admin
    .from("property_media")
    .select("storage_path, file_type, property:properties(status, deleted_at)")
    .eq("id", id)
    .eq("kind", "image")
    .maybeSingle();

  // Yalnızca herkese açık listelenen (taslak/silinmiş olmayan) portföylerin görselleri servis edilir
  const prop = media && (Array.isArray(media.property) ? media.property[0] : media.property);
  const isPublic = prop && !prop.deleted_at && prop.status !== "draft";
  if (!media?.storage_path || !isPublic) {
    return NextResponse.json({ error: "Görsel bulunamadı" }, { status: 404 });
  }

  const { data: blob, error } = await admin.storage.from("property-media").download(media.storage_path);
  if (error || !blob) {
    return NextResponse.json({ error: "İndirilemedi" }, { status: 500 });
  }

  return new NextResponse(blob, {
    headers: {
      "Content-Type": media.file_type || "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
