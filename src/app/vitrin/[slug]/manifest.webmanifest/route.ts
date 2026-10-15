import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { loadVitrinSettings } from "@/lib/vitrin-settings";
import { buildVitrinManifest } from "@/lib/vitrin-manifest";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * GET /vitrin/<slug>/manifest.webmanifest — ofis markalı PWA manifest'i (PUB-10). Yalnız herkese açık vitrin alanları
 * (ad, renk, logo) okunur; vitrin kapalı/askıdaki ofis için 404. service_role yalnız bu tek tenants satırını okur
 * (vitrin sayfasının metadata sorgusuyla aynı alan alt kümesi).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG_RE.test(slug)) return new NextResponse("Bulunamadı", { status: 404 });
  const admin = createAdminClient();
  const { data: tenant } = await admin.from("tenants").select("id, name, slug, status, brand_color, logo_url").eq("slug", slug).maybeSingle();
  if (!tenant || !isPublicTenantActive(tenant.status)) return new NextResponse("Bulunamadı", { status: 404 });
  const vitrin = await loadVitrinSettings(admin, tenant.id);
  if (!vitrin.settings.enabled) return new NextResponse("Bulunamadı", { status: 404 });
  const manifest = buildVitrinManifest({ name: tenant.name, slug: tenant.slug ?? slug, brandColor: tenant.brand_color, logoUrl: tenant.logo_url });
  return new NextResponse(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
