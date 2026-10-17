import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { OPEN_LISTING_OR_FILTER } from "@/lib/closed-listing";
import { getBaseUrl } from "@/lib/base-url";
import { getPlatformSettingsMany } from "@/lib/platform-settings";
import { filterSafeEntries, historyHeadAt, staticSitemapEntries, chunkEntries, type SitemapEntry } from "./sitemap-rules";
import { SEO_CACHE_TAG, getHubSettings, getSeoSettings } from "./store";
import { loadIncludedOffices } from "./included-offices";
import { hubSitemapEntries } from "./hubs/data";
import { sitePageSitemapEntries } from "@/lib/site-pages/metadata";
import { listPublishedSitePages } from "@/lib/site-pages/store";
import { listGuideSitemapEntries } from "@/lib/guides/sitemap";
import { GUIDES_CACHE_TAG } from "@/lib/guides/store";
import { LISTING_SLUG_COLUMNS, listingSlugInput, vitrinListingUrl, type ListingSlugRow } from "@/lib/vitrin/listing-slug";

/**
 * Sitemap veri yükleyici (sunucu). Kurallar:
 *  - Statik sayfalar/araçlar: registry + admin override (noindex olanlar girmez).
 *  - Sayfa oluşturucu (/admin/site/sayfalar): yalnız yayında + index + inSitemap olan özel sayfalar ("Statik sayfalar"
 *    anahtarına bağlı). Robot denetimi sitemap'i taradığı için onları kendiliğinden kapsar.
 *  - Vitrin ofisi/ilanı/danışman: yalnız aktif ofis + (varsayılan) opt-in verenler. Opt-in TEK kaynağı ofisin
 *    kendi ayarıdır (tenants.vitrin_seo_optin, /app/ayarlar/vitrin); sütun yoksa eski elle slug listesi geçerli kalır.
 *    Kalıcı noindex listesindeki ve örnek veri taşıyan ofisler girmez (vitrin-seo/store.ts).
 *  - Rehber: yayındaki indekslenebilir yazılar ve liste/kategori sayfaları (guides/sitemap.ts).
 *  - İlanlar: yalnız status=live, silinmemiş, is_sample=false. Token'lı portallar HİÇ girmez.
 *  - lastModified: yalnız gerçek updated_at; yoksa alan yazılmaz (sahte "bugün" yok).
 * Veritabanı yoksa/başarısızsa statik kısım yine döner (sitemap kırılmaz).
 */

export const SITEMAP_CACHE_TAG = "seo-sitemap";

/** Yayın yüzeylerinin geçmiş anahtarları (versioned-config `<prefix>.history`; site-content ve pricing-page depoları). */
export const PUBLISH_HISTORY_KEYS = { home: "sitecontent.history", pricing: "pricingpage.history" } as const;
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
  const [settings, sitePages, guideEntries] = await Promise.all([getSeoSettings(), listPublishedSitePages(), listGuideSitemapEntries(base)]);
  // Gerçek lastmod: yayın yüzeylerinin son CANLI geçmiş girdisi (sitecontent -> "/", pricingpage -> "/fiyatlar",
  // sayfa oluşturucu -> kendi slug'ı). Tek sorgu; okunamazsa boş (lastmod yazılmaz, sahte "bugün" yok).
  const historyKeys = [PUBLISH_HISTORY_KEYS.home, PUBLISH_HISTORY_KEYS.pricing, ...sitePages.map((p) => `sitepage.${p.id}.history`)];
  const histories = await getPlatformSettingsMany(historyKeys).catch(() => ({}) as Record<string, string | null>);
  const publishedAt: Record<string, string | undefined> = {
    "/": historyHeadAt(histories[PUBLISH_HISTORY_KEYS.home]),
    "/fiyatlar": historyHeadAt(histories[PUBLISH_HISTORY_KEYS.pricing]),
  };
  const entries: SitemapEntry[] = staticSitemapEntries(base, settings.pages, settings.sitemap, publishedAt);
  const sm = settings.sitemap;
  if (sm.staticPages) {
    // Özel sayfa lastmod'u: kendi yayın geçmişi; yoksa alan boş kalır (sitePageSitemapEntries geçersiz zamanı yazmaz).
    const withPublishTime = sitePages.map((p) => ({ ...p, updatedAt: historyHeadAt(histories[`sitepage.${p.id}.history`]) ?? "" }));
    entries.push(...sitePageSitemapEntries(base, withPublishTime));
  }
  // Rehber (S5): yayındaki indekslenebilir yazılar + liste/kategori sayfaları; lastmod = gerçek yayın zamanı.
  entries.push(...guideEntries);

  if (sm.vitrinOffices || sm.vitrinListings || sm.advisors) {
    try {
      const admin = createAdminClient();
      const offices = await loadIncludedOffices(admin, sm);
      const included = new Map<string, string>([...offices].map(([id, o]) => [id, o.slug])); // tenant_id -> slug
      if (sm.vitrinOffices) {
        for (const o of offices.values()) {
          entries.push({ url: `${base}/vitrin/${o.slug}`, lastModified: iso(o.updatedAt), changeFrequency: "daily", priority: 0.7 });
          // Ücretsiz değerleme sayfası bilerek indekslenebilirdir ("SEO mıknatısı"); ofisle birlikte girer.
          entries.push({ url: `${base}/vitrin/${o.slug}/degerleme`, changeFrequency: "monthly", priority: 0.5 });
        }
      }

      if (sm.vitrinListings && included.size > 0) {
        const listings = await fetchAll(
          (from, to) =>
            admin
              .from("properties")
              .select(`${LISTING_SLUG_COLUMNS}, tenant_id, updated_at`)
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
          entries.push({ url: vitrinListingUrl(base, slug, listingSlugInput(l as unknown as ListingSlugRow)), lastModified: iso(l.updated_at), changeFrequency: "weekly", priority: 0.6 });
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

  // Programatik bölge sayfaları (/emlak/...): özellik açıksa yalnız eşiği geçen (index) sayfalar; lastmod = en yeni ilan.
  try {
    const hubs = await getHubSettings();
    if (hubs.enabled) entries.push(...(await hubSitemapEntries(base)));
  } catch {
    // bölge sayfaları okunamazsa sitemap'in geri kalanı etkilenmez
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
  // Rehber yayını `guides` etiketini düşürür: yeni yazı sitemap'e 30 dk beklemeden girer.
  { tags: [SEO_CACHE_TAG, SITEMAP_CACHE_TAG, GUIDES_CACHE_TAG], revalidate: 1800 },
);

/** Önbelleksiz (robot ve admin önizleme). */
export async function loadSitemapFresh(): Promise<{ chunks: SitemapEntry[][]; total: number }> {
  const { entries, maxPerSitemap } = await loadAll();
  return { chunks: chunkEntries(entries, maxPerSitemap), total: entries.length };
}
