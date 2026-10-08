import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { OPEN_LISTING_OR_FILTER } from "@/lib/closed-listing";
import { getBaseUrl } from "@/lib/base-url";
import { filterSafeEntries, staticSitemapEntries, tenantInSitemap, chunkEntries, type SitemapEntry } from "./sitemap-rules";
import { SEO_CACHE_TAG, getSeoSettings } from "./store";
import { resolveOptInSlugs } from "@/lib/vitrin-settings-logic";

/**
 * Sitemap veri yükleyici (sunucu). Kurallar:
 *  - Statik sayfalar/araçlar: registry + admin override (noindex olanlar girmez).
 *  - Vitrin ofisi/ilanı/danışman: yalnız aktif ofis + (varsayılan) opt-in verenler. Opt-in TEK kaynağı ofisin
 *    kendi ayarıdır (tenants.vitrin_seo_optin, /app/ayarlar/vitrin); sütun yoksa eski elle slug listesi geçerli kalır.
 *  - İlanlar: yalnız status=live, silinmemiş, is_sample=false. Token'lı portallar HİÇ girmez.
 *  - lastModified: yalnız gerçek updated_at; yoksa alan yazılmaz (sahte "bugün" yok).
 * Veritabanı yoksa/başarısızsa statik kısım yine döner (sitemap kırılmaz).
 */

export const SITEMAP_CACHE_TAG = "seo-sitemap";
const PAGE = 1000;
const HARD_CAP = 49000;

type Row = Record<string, unknown>;

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

const iso = (v: unknown): string | undefined => {
  if (typeof v !== "string" || !v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

async function loadAll(): Promise<{ entries: SitemapEntry[]; generatedAt: string; maxPerSitemap: number }> {
  const base = getBaseUrl();
  const settings = await getSeoSettings();
  const entries: SitemapEntry[] = staticSitemapEntries(base, settings.pages, settings.sitemap);
  const sm = settings.sitemap;

  if (sm.vitrinOffices || sm.vitrinListings || sm.advisors) {
    try {
      const admin = createAdminClient();
      const tenants = await fetchAll(
        (from, to) =>
          admin
            .from("tenants")
            .select("id, slug, updated_at")
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
      // Vitrinini kapatan ofis (vitrin_enabled=false) sitemap'e HİÇ girmez (sayfa 404 verir). Sütun yoksa (sorgu hata
      // verir) süzgeç uygulanmaz: bugünkü davranış. Tek sorgu: kapalı ofis kimlikleri.
      const closedRes = await admin
        .from("tenants")
        .select("id")
        .eq("vitrin_enabled", false)
        .limit(5000);
      const vitrinClosedIds = new Set<string>(
        closedRes.error ? [] : ((closedRes.data ?? []) as unknown as { id: string }[]).map((r) => String(r.id)),
      );
      const included = new Map<string, string>(); // tenant_id -> slug
      for (const t of tenants ?? []) {
        const slug = typeof t.slug === "string" ? t.slug : "";
        if (!slug || !tenantInSitemap(smEff, slug)) continue;
        if (vitrinClosedIds.has(String(t.id))) continue;
        included.set(String(t.id), slug);
        if (sm.vitrinOffices) {
          entries.push({ url: `${base}/vitrin/${slug}`, lastModified: iso(t.updated_at), changeFrequency: "daily", priority: 0.7 });
          // Ücretsiz değerleme sayfası bilerek indekslenebilirdir ("SEO mıknatısı"); ofisle birlikte girer.
          entries.push({ url: `${base}/vitrin/${slug}/degerleme`, changeFrequency: "monthly", priority: 0.5 });
        }
      }

      if (sm.vitrinListings && included.size > 0) {
        const listings = await fetchAll(
          (from, to) =>
            admin
              .from("properties")
              .select("id, tenant_id, updated_at")
              .eq("status", "live")
              .eq("is_sample", false)
              .is("deleted_at", null)
              .or(OPEN_LISTING_OR_FILTER)
              .order("updated_at", { ascending: false })
              .range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: unknown }>,
          HARD_CAP,
        );
        for (const l of listings ?? []) {
          const slug = included.get(String(l.tenant_id));
          if (!slug) continue;
          entries.push({ url: `${base}/vitrin/${slug}/${l.id}`, lastModified: iso(l.updated_at), changeFrequency: "weekly", priority: 0.6 });
        }
      }

      if (sm.advisors && included.size > 0) {
        const agents = await fetchAll(
          (from, to) =>
            admin
              .from("profiles")
              .select("public_slug, tenant_id")
              .eq("is_public", true)
              .eq("is_active", true)
              .eq("is_sample", false)
              .not("public_slug", "is", null)
              .range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: unknown }>,
          10000,
        );
        for (const a of agents ?? []) {
          if (!a.public_slug || !included.has(String(a.tenant_id))) continue;
          // profiles'ta güvenilir güncelleme zamanı yok: lastmod YAZILMAZ.
          entries.push({ url: `${base}/danisman/${a.public_slug}`, changeFrequency: "weekly", priority: 0.6 });
        }
      }
    } catch {
      // env yoksa statik kısımla devam
    }
  }

  return { entries: filterSafeEntries(entries).slice(0, HARD_CAP * 4), generatedAt: new Date().toISOString(), maxPerSitemap: sm.maxUrlsPerSitemap };
}

/** Önbellekli sitemap girdileri (30 dk) + parçalar. */
export const getSitemapChunks = unstable_cache(
  async (): Promise<{ chunks: SitemapEntry[][]; generatedAt: string; total: number }> => {
    const { entries, generatedAt, maxPerSitemap } = await loadAll();
    return { chunks: chunkEntries(entries, maxPerSitemap), generatedAt, total: entries.length };
  },
  ["seo-sitemap-v1"],
  { tags: [SEO_CACHE_TAG, SITEMAP_CACHE_TAG], revalidate: 1800 },
);

/** Önbelleksiz (robot ve admin önizleme). */
export async function loadSitemapFresh(): Promise<{ chunks: SitemapEntry[][]; total: number }> {
  const { entries, maxPerSitemap } = await loadAll();
  return { chunks: chunkEntries(entries, maxPerSitemap), total: entries.length };
}
