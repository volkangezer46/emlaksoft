import { createAdminClient } from "@/lib/supabase/admin";
import { isVitrinEnabled } from "@/lib/vitrin-settings";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { OG_SIZE, renderVitrinOg } from "@/lib/vitrin-og";

export const alt = "Emlak ilanı";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 300;

type Rel = { name?: string } | { name?: string }[] | null;
const nm = (v: Rel) => (Array.isArray(v) ? v[0]?.name : v?.name) ?? null;

/** İlan başına dinamik paylaşım kartı (WhatsApp/sosyal önizleme). Fotoğraf varsa sayfa metadata'sı fotoğrafı kullanır; bu kart fotoğrafsız ilanın yedeğidir. */
export default async function Image({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, status, logo_url, brand_color")
    .eq("slug", slug)
    .maybeSingle();
  const active = tenant && isPublicTenantActive(tenant.status) && (await isVitrinEnabled(admin, tenant.id));
  const { data: p } = active
    ? await admin
        .from("properties")
        .select("title, property_code, transaction_type, list_price, features, province:geo_provinces(name), district:geo_districts(name)")
        .eq("id", id)
        .eq("tenant_id", tenant.id)
        .eq("status", "live")
        .is("deleted_at", null)
        .eq("is_sample", false)
        .maybeSingle()
    : { data: null };

  if (!tenant || !active || !p) {
    return renderVitrinOg({ office: "EmlakSoft", title: "İlan bulunamadı" });
  }
  const feat = (p.features ?? {}) as { rooms?: string; sqm?: number };
  const tx = (p.transaction_type ?? "").toLowerCase();
  const rent = tx === "rent" || tx.includes("kira");
  const price =
    p.list_price != null
      ? `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(Number(p.list_price))} ₺${rent ? "/ay" : ""}`
      : null;
  return renderVitrinOg({
    office: tenant.name ?? "EmlakSoft",
    logoUrl: tenant.logo_url,
    brandColor: tenant.brand_color,
    badge: p.transaction_type,
    title: p.title || p.property_code,
    location: [nm(p.district as Rel), nm(p.province as Rel)].filter(Boolean).join(", ") || null,
    price,
    specs: [feat.rooms, feat.sqm ? `${feat.sqm} m²` : null].filter(Boolean) as string[],
  });
}
