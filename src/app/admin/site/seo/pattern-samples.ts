import "server-only";
import { listingSlugInput, vitrinListingPath } from "@/lib/vitrin/listing-slug";
import { createAdminClient } from "@/lib/supabase/admin";
import { OPEN_LISTING_OR_FILTER } from "@/lib/closed-listing";
import type { SeoPatternVars } from "@/lib/seo/patterns";

/**
 * /admin/site/seo "Dinamik kalıplar" sekmesinin verisi (salt okunur, yalnız seo modüllü platform personeli; sayfa kapısı
 * requirePlatformModule("seo")). Önizleme GERÇEK kayıtla yapılır: ilk yayındaki ilan, onun ofisi ve ilk yayındaki
 * danışman. Ofislerin arama onayı tablosu "Vitrin" sekmesindedir (vitrin-offices.ts).
 */

export type PatternSample = { url: string; vars: SeoPatternVars; ownText: string | null } | null;

export type PatternData = {
  office: PatternSample;
  listing: PatternSample;
  agent: PatternSample;
};

type Rel = { name?: string } | { name?: string }[] | null;
const relName = (v: Rel) => (Array.isArray(v) ? v[0]?.name : v?.name) ?? null;

function money(n: number | null, tx?: string | null) {
  if (n == null) return "Fiyat için sorun";
  const s = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
  return tx === "rent" || (tx ?? "").toLowerCase().includes("kira") ? `${s}/ay` : s;
}

const ACTIVE = ["trial", "active", "past_due"];

export async function loadPatternData(): Promise<PatternData> {
  const empty: PatternData = { office: null, listing: null, agent: null };
  try {
    const admin = createAdminClient();
    const [listingRes, agentRes, tenantsRes] = await Promise.all([
      admin
        .from("properties")
        .select("id, tenant_id, title, property_code, transaction_type, property_type, list_price, address_line, features, province:geo_provinces(name), district:geo_districts(name)")
        .eq("status", "live")
        .eq("is_sample", false)
        .is("deleted_at", null)
        .or(OPEN_LISTING_OR_FILTER)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("profiles")
        .select("tenant_id, full_name, title, bio, specialties, public_slug")
        .eq("is_public", true)
        .eq("is_active", true)
        .eq("is_sample", false)
        .not("public_slug", "is", null)
        .limit(1)
        .maybeSingle(),
      admin
        .from("tenants")
        .select("id, slug, name, status, vitrin_seo_optin")
        .in("status", ACTIVE)
        .order("vitrin_seo_optin", { ascending: false })
        .order("name", { ascending: true })
        .limit(200),
    ]);

    const tenants = (tenantsRes.data ?? []) as { id: string; slug: string | null; name: string | null }[];
    const byId = new Map(tenants.map((t) => [t.id, t]));
    const out: PatternData = { ...empty };

    const p = listingRes.data as
      | { id: string; tenant_id: string; title: string | null; property_code: string | null; transaction_type: string | null; property_type: string | null; list_price: number | null; address_line: string | null; features: { rooms?: string; description?: string } | null; province: Rel; district: Rel }
      | null;
    const ownerTenant = p ? byId.get(p.tenant_id) : undefined;
    if (p && ownerTenant?.slug) {
      const priceText = money(p.list_price != null ? Number(p.list_price) : null, p.transaction_type);
      const loc = [p.address_line, relName(p.district), relName(p.province)].filter(Boolean).join(", ");
      const { count } = await admin
        .from("properties")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", p.tenant_id)
        .eq("status", "live")
        .is("deleted_at", null)
        .eq("is_sample", false)
        .or(OPEN_LISTING_OR_FILTER);
      out.office = { url: `/vitrin/${ownerTenant.slug}`, vars: { ofis: ownerTenant.name, ilan_sayisi: count ?? 0 }, ownText: null };
      out.listing = {
        url: vitrinListingPath(ownerTenant.slug, listingSlugInput(p)),
        vars: {
          ofis: ownerTenant.name,
          ilan_basligi: p.title || p.property_code,
          fiyat: priceText,
          il: relName(p.province),
          ilce: relName(p.district),
          konum: loc || "Türkiye",
          islem: p.transaction_type,
          tip: p.property_type,
          oda: p.features?.rooms ?? null,
        },
        ownText: p.features?.description?.trim() || null,
      };
    }

    const a = agentRes.data as { tenant_id: string; full_name: string; title: string | null; bio: string | null; specialties: string[] | null; public_slug: string } | null;
    if (a) {
      const office = byId.get(a.tenant_id)?.name ?? "Emlak ofisi";
      const role = a.title?.trim() || "Emlak danışmanı";
      out.agent = {
        url: `/danisman/${a.public_slug}`,
        vars: {
          danisman: a.full_name,
          ofis: office,
          unvan: role,
          unvan_kucuk: role.toLocaleLowerCase("tr"),
          uzmanlik: a.specialties?.length ? `Uzmanlık: ${a.specialties.join(", ")}. ` : "",
        },
        ownText: a.bio?.trim() || null,
      };
    }
    return out;
  } catch {
    return empty;
  }
}
