import type { createAdminClient } from "@/lib/supabase/admin";
import { resolveOptInSlugs } from "@/lib/vitrin-settings-logic";
import { loadVitrinSitemapExclusions } from "@/lib/vitrin-seo/store";
import type { SeoSitemapSettings } from "./schema";
import { tenantInSitemap } from "./sitemap-rules";

type Row = Record<string, unknown>;
const PAGE = 1000;

async function fetchAll(build: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: unknown }>, cap: number): Promise<Row[] | null> {
  const out: Row[] = [];
  for (let from = 0; from < cap; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) return out.length > 0 ? out : null;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export type AdminClient = ReturnType<typeof createAdminClient>;

export type IncludedOffice = { slug: string; name: string; updatedAt: unknown };

/**
 * Arama motoruna açık ofisler (tenant_id → slug/ad): aktif + vitrini açık + arama onayı (ofis ayarı; sütun yoksa elle
 * slug listesi) + kalıcı noindex/örnek veri dışı. Sitemap ve programatik bölge sayfaları (hubs/data.ts) AYNI kümeyi kullanır.
 */
export async function loadIncludedOffices(admin: AdminClient, sm: SeoSitemapSettings): Promise<Map<string, IncludedOffice>> {
  const tenants = await fetchAll(
    (from, to) =>
      admin
        .from("tenants")
        .select("id, slug, name, updated_at")
        .in("status", ["trial", "active", "past_due"])
        .order("updated_at", { ascending: false })
        .range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: unknown }>,
    5000,
  );
  // Opt-in: ofis ayarı (tek kaynak). Sütun yoksa sorgu hata verir -> elle liste geri dönüş olarak kalır.
  const optinRes = await admin
    .from("tenants")
    .select("slug, vitrin_seo_optin")
    .in("status", ["trial", "active", "past_due"])
    .eq("vitrin_seo_optin", true)
    .limit(5000);
  const optInSlugs = resolveOptInSlugs({
    columnAvailable: !optinRes.error,
    manualSlugs: sm.optInTenantSlugs,
    tenants: ((optinRes.data ?? []) as unknown as { slug: string | null; vitrin_seo_optin: boolean | null }[]).map((r) => ({
      slug: r.slug,
      seoOptin: r.vitrin_seo_optin === true,
    })),
  });
  const smEff = { ...sm, optInTenantSlugs: optInSlugs };
  // Vitrinini kapatan ofis (vitrin_enabled=false) HİÇ girmez (sayfa 404 verir). Sütun yoksa süzgeç uygulanmaz.
  const closedRes = await admin.from("tenants").select("id").eq("vitrin_enabled", false).limit(5000);
  const vitrinClosedIds = new Set<string>(closedRes.error ? [] : ((closedRes.data ?? []) as unknown as { id: string }[]).map((r) => String(r.id)));
  // Kalıcı noindex listesi ve örnek veri kiracıları (vitrin SEO, SP7): sayfaları noindex'tir, girmez.
  const vitrinExcluded = await loadVitrinSitemapExclusions(admin).catch(() => (_slug: string) => false);
  const out = new Map<string, IncludedOffice>();
  for (const t of tenants ?? []) {
    const slug = typeof t.slug === "string" ? t.slug : "";
    if (!slug || !tenantInSitemap(smEff, slug) || vitrinExcluded(slug)) continue;
    if (vitrinClosedIds.has(String(t.id))) continue;
    out.set(String(t.id), { slug, name: typeof t.name === "string" && t.name ? t.name : slug, updatedAt: t.updated_at });
  }
  return out;
}

