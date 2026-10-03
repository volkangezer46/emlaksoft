import { NextRequest, NextResponse } from "next/server";
import { verifyShortLivedPropertyMediaClaim } from "@/lib/property-media-access";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIpFromHeaders } from "@/lib/public-request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notFoundResponse() {
  return NextResponse.json(
    { error: "Gorsel bulunamadi." },
    {
      status: 404,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = request.nextUrl.searchParams.get("scope") ?? "";
  const expiresAt = request.nextUrl.searchParams.get("exp") ?? "";
  const sig = request.nextUrl.searchParams.get("sig") ?? "";

  if (
    !verifyShortLivedPropertyMediaClaim({
      mediaId: id,
      scope,
      expiresAt,
      signature: sig,
    })
  ) {
    return notFoundResponse();
  }

  const ip = clientIpFromHeaders(request.headers);
  const rate = await checkRateLimit(`property-media-private:${ip}`, {
    limit: 240,
    windowSec: 60,
    failurePolicy: "deny",
    // İmzalı, kısa ömürlü okuma: ilk 60 çağrı/isolate DB yazması yapmaz (üst sınır limit/4).
    localAllowance: 60,
  });
  if (!rate.allowed) return notFoundResponse();

  const admin = createAdminClient();
  const { data: media, error: mediaError } = await admin
    .from("property_media")
    .select("storage_path, file_type, property:properties!property_media_property_id_fkey(deleted_at, tenant:tenants(status))")
    .eq("id", id)
    .eq("kind", "image")
    .maybeSingle();
  const property = media && (Array.isArray(media.property) ? media.property[0] : media.property);
  const tenant = property && (Array.isArray(property.tenant) ? property.tenant[0] : property.tenant);
  if (
    mediaError ||
    !media?.storage_path ||
    !property ||
    property.deleted_at ||
    !tenant ||
    !isPublicTenantActive(tenant.status) ||
    !/^image\/(?:avif|gif|jpeg|png|webp)$/i.test(media.file_type ?? "")
  ) {
    return notFoundResponse();
  }

  const { data: blob, error } = await admin.storage
    .from("property-media")
    .download(media.storage_path);
  if (error || !blob) return notFoundResponse();

  return new NextResponse(blob, {
    headers: {
      "Content-Type": media.file_type,
      "Cache-Control": "private, no-store, max-age=0",
      "CDN-Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
