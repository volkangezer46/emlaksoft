import { NextResponse } from "next/server";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: media } = await admin
    .from("property_media")
    .select("storage_path, file_type, property:properties!property_media_property_id_fkey(status, deleted_at, tenant_id)")
    .eq("id", id)
    .eq("kind", "image")
    .maybeSingle();

  // Yalnızca herkese açık listelenen (taslak/silinmiş olmayan) portföylerin görselleri servis edilir
  const prop = media && (Array.isArray(media.property) ? media.property[0] : media.property);
  let isPublic = Boolean(prop && !prop.deleted_at && prop.status === "live");
  if (isPublic && prop) {
    const { data: tenant, error: tenantError } = await admin
      .from("tenants")
      .select("status")
      .eq("id", prop.tenant_id)
      .maybeSingle();
    isPublic = !tenantError && Boolean(tenant) && isPublicTenantActive(tenant?.status);
  }
  if (!media?.storage_path || !isPublic) {
    return NextResponse.json({ error: "Görsel bulunamadı" }, { status: 404 });
  }

  if (!/^image\/(?:avif|gif|jpeg|png|webp)$/i.test(media.file_type ?? "")) {
    return NextResponse.json({ error: "Görsel bulunamadı." }, { status: 404 });
  }

  const { data: blob, error } = await admin.storage.from("property-media").download(media.storage_path);
  if (error || !blob) {
    return NextResponse.json({ error: "İndirilemedi" }, { status: 500 });
  }

  return new NextResponse(blob, {
    headers: {
      "Content-Type": media.file_type,
      "Cache-Control": "public, max-age=60, s-maxage=60, must-revalidate",
      "CDN-Cache-Control": "public, s-maxage=60, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
