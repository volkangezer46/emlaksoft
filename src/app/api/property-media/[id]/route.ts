import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: media } = await admin
    .from("property_media")
    .select("storage_path, file_type")
    .eq("id", id)
    .eq("kind", "image")
    .maybeSingle();

  if (!media?.storage_path) {
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
