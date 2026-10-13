import { unstable_cache } from "next/cache";
import { getPlatformSetting, setPlatformSetting } from "@/lib/platform-settings";
import { createVersionedStore } from "@/lib/versioned-config/store";
import { parseSitePageContent, parseSitePageIndex, type SitePageContent, type SitePageIndexEntry } from "./schema";

/**
 * Sayfa oluşturucu depolama (platform_settings, yeni migration yok):
 *   sitepages.index            -> [{id, slug, title, kind, status, updatedAt, updatedBy}] (en çok 50)
 *   sitepage.<id>.live|draft|history -> ortak taslak/yayın/geçmiş kalıbı (createVersionedStore)
 * Herkese açık okuma iki küçük önbellekten gelir (etiket `site-pages`, 300 sn; yayında updateTag): yol→kimlik haritası ve
 * sayfa başına yayındaki içerik. İstek başına veritabanı sorgusu YOKTUR.
 */

export const SITE_PAGES_CACHE_TAG = "site-pages";
export const SITE_PAGES_INDEX_KEY = "sitepages.index";

export const SITE_PAGES_STORAGE_UNAVAILABLE =
  "Sayfa kaydedilemedi: platform ayarları tablosuna yazılamadı. Veritabanı bağlantısını ve platform_settings tablosunu kontrol edin.";

export function sitePageStore(id: string) {
  return createVersionedStore<SitePageContent>({
    prefix: `sitepage.${id}`,
    parseValue: parseSitePageContent,
    unavailableMessage: SITE_PAGES_STORAGE_UNAVAILABLE,
  });
}

/** Önbelleksiz sayfa listesi (yönetim ekranı ve yazmalar). Okunamazsa boş liste. */
export async function readSitePageIndex(): Promise<SitePageIndexEntry[]> {
  const raw = await getPlatformSetting(SITE_PAGES_INDEX_KEY);
  if (!raw) return [];
  try {
    return parseSitePageIndex(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Listeyi yazar ve geri okuyarak doğrular. */
export async function writeSitePageIndex(list: readonly SitePageIndexEntry[], staffId: string): Promise<boolean> {
  const json = JSON.stringify(list);
  if (!(await setPlatformSetting(SITE_PAGES_INDEX_KEY, json, staffId))) return false;
  return (await getPlatformSetting(SITE_PAGES_INDEX_KEY)) === json;
}

/** Yayındaki sayfaların yol→kimlik haritası (önbellekli). */
export const getPublishedSlugMap = unstable_cache(
  async (): Promise<Record<string, string>> => {
    const out: Record<string, string> = {};
    for (const e of await readSitePageIndex()) if (e.status === "yayinda" && e.slug) out[e.slug] = e.id;
    return out;
  },
  ["site-pages-map-v1"],
  { tags: [SITE_PAGES_CACHE_TAG], revalidate: 300 },
);

/** Bir sayfanın yayındaki içeriği (önbellekli; kimlik anahtarın parçasıdır). */
export const getLiveSitePage = unstable_cache(
  async (id: string): Promise<SitePageContent | null> => sitePageStore(id).readLive(),
  ["site-pages-live-v1"],
  { tags: [SITE_PAGES_CACHE_TAG], revalidate: 300 },
);

export type PublishedSitePage = { id: string; slug: string; updatedAt: string; content: SitePageContent };

/** Yayındaki tüm sayfalar (sitemap, SEO envanteri). Önbellekli parçalardan okunur. */
export async function listPublishedSitePages(): Promise<PublishedSitePage[]> {
  try {
    const index = await readSitePageIndexCached();
    const live = index.filter((e) => e.status === "yayinda" && e.slug);
    const contents = await Promise.all(live.map((e) => getLiveSitePage(e.id)));
    const out: PublishedSitePage[] = [];
    live.forEach((e, i) => {
      const content = contents[i];
      if (content) out.push({ id: e.id, slug: e.slug, updatedAt: e.updatedAt, content });
    });
    return out;
  } catch {
    return [];
  }
}

const readSitePageIndexCached = unstable_cache(async () => readSitePageIndex(), ["site-pages-index-v1"], {
  tags: [SITE_PAGES_CACHE_TAG],
  revalidate: 300,
});
