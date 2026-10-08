import { createAdminClient } from "@/lib/supabase/admin";
import { isVitrinEnabled } from "@/lib/vitrin-settings";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { OPEN_LISTING_OR_FILTER } from "@/lib/closed-listing";
import { OG_SIZE, renderVitrinOg } from "@/lib/vitrin-og";

export const alt = "Portföy vitrini";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 300;

/** Ofis vitrini paylaşım kartı — ofis adı, logo (PNG/JPG varsa) ve gerçek aktif ilan sayısı. */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, status, logo_url, brand_color")
    .eq("slug", slug)
    .maybeSingle();
  if (!tenant || !isPublicTenantActive(tenant.status) || !(await isVitrinEnabled(admin, tenant.id))) {
    return renderVitrinOg({ office: "EmlakSoft", title: "Vitrin bulunamadı" });
  }
  const { count } = await admin
    .from("properties")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id)
    .eq("status", "live")
    .is("deleted_at", null)
    .eq("is_sample", false)
    .or(OPEN_LISTING_OR_FILTER);
  return renderVitrinOg({
    office: tenant.name ?? "EmlakSoft",
    logoUrl: tenant.logo_url,
    brandColor: tenant.brand_color,
    title: "Güncel portföy vitrini",
    location: "Satılık ve kiralık ilanlar",
    specs: count ? [`${count} aktif ilan`] : [],
  });
}
