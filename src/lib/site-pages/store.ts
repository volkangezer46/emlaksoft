import { unstable_cache } from "next/cache";
import { getPlatformSetting, readPlatformSettingStrict, setPlatformSetting } from "@/lib/platform-settings";
import { createVersionedStore } from "@/lib/versioned-config/store";
import { parseSitePageContent, parseSitePageIndexStrict, type SitePageContent, type SitePageIndexEntry } from "./schema";

/**
 * Sayfa oluşturucu depolama (platform_settings, yeni migration yok):
 *   sitepages.index            -> [{id, slug, title, kind, status, updatedAt, updatedBy}] (en çok 50)
 *   sitepage.<id>.live|draft|history -> ortak taslak/yayın/geçmiş kalıbı (createVersionedStore)
 * Herkese açık okuma iki küçük önbellekten gelir (etiket `site-pages`, 300 sn; yayında updateTag): yol→kimlik haritası ve
 * sayfa başına yayındaki içerik. İstek başına veritabanı sorgusu YOKTUR.
 * "Okunamadı" asla "kayıt yok" sayılmaz: önbellekli okumalar hata FIRLATIR (unstable_cache hatayı saklamaz; geçici DB
 * hatası 300 sn boyunca 404 üretmez), yazmalar okunamayan/bozuk listeyi ezmez ve listeyi sürüm kilidiyle yazar.
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

export type SitePageIndexRead = { ok: true; list: SitePageIndexEntry[]; version: number | null } | { ok: false };

/**
 * Önbelleksiz, sıkı liste okuması: kayıt yoksa boş liste (sürüm 0), okuma hatası veya bozuk liste `{ ok: false }`.
 * `version` iyimser kilit içindir (sütun yoksa null: kilitsiz yazılır).
 */
export async function readSitePageIndexState(): Promise<SitePageIndexRead> {
  try {
    const row = await readPlatformSettingStrict(SITE_PAGES_INDEX_KEY);
    if (!row) return { ok: true, list: [], version: 0 };
    if (row.value === null) return { ok: true, list: [], version: row.version };
    const list = parseSitePageIndexStrict(JSON.parse(row.value));
    if (!list) {
      console.error("readSitePageIndexState: sayfa listesi doğrulanamadı");
      return { ok: false };
    }
    return { ok: true, list, version: row.version };
  } catch (e) {
    console.error("readSitePageIndexState", e);
    return { ok: false };
  }
}

/** Yönetim ekranları için liste (yalnız gösterim; okunamazsa boş). Yazmalar readSitePageIndexState kullanır. */
export async function readSitePageIndex(): Promise<SitePageIndexEntry[]> {
  const r = await readSitePageIndexState();
  return r.ok ? r.list : [];
}

/** Önbellekli okumalar için: okunamazsa FIRLATIR (boş sonuç önbelleğe girmesin). */
async function readSitePageIndexOrThrow(): Promise<SitePageIndexEntry[]> {
  const r = await readSitePageIndexState();
  if (!r.ok) throw new Error("Sayfa listesi okunamadı.");
  return r.list;
}

export type SitePageIndexWrite = "ok" | "conflict" | "fail";

/**
 * Listeyi okunduğu sürüme göre yazar (write_setting RPC, p_expected_version): arada başka bir yazma olduysa hiçbir şey
 * yazılmaz ve "conflict" döner. Sürüm bilinmiyorsa (sütun yok) kilitsiz yazılır. Yazım geri okunarak doğrulanır.
 */
export async function writeSitePageIndex(list: readonly SitePageIndexEntry[], staffId: string, expectedVersion: number | null): Promise<SitePageIndexWrite> {
  const json = JSON.stringify(list);
  const out: { conflict?: boolean } = {};
  const meta = expectedVersion === null ? undefined : { expectedVersion, reason: "Sayfa listesi", summary: `${list.length} sayfa`, out };
  if (!(await setPlatformSetting(SITE_PAGES_INDEX_KEY, json, staffId, meta))) return out.conflict ? "conflict" : "fail";
  return (await getPlatformSetting(SITE_PAGES_INDEX_KEY)) === json ? "ok" : "fail";
}

/** Yayındaki sayfaların yol→kimlik haritası (önbellekli). */
export const getPublishedSlugMap = unstable_cache(
  async (): Promise<Record<string, string>> => {
    const out: Record<string, string> = {};
    for (const e of await readSitePageIndexOrThrow()) if (e.status === "yayinda" && e.slug) out[e.slug] = e.id;
    return out;
  },
  ["site-pages-map-v1"],
  { tags: [SITE_PAGES_CACHE_TAG], revalidate: 300 },
);

/** Bir sayfanın yayındaki içeriği (önbellekli; kimlik anahtarın parçasıdır). Okuma hatasında FIRLATIR; bozuk içerik null. */
export const getLiveSitePage = unstable_cache(
  async (id: string): Promise<SitePageContent | null> => {
    const store = sitePageStore(id);
    const row = await readPlatformSettingStrict(store.keys.live);
    return store.parseConfig(row?.value ?? null);
  },
  ["site-pages-live-v1"],
  { tags: [SITE_PAGES_CACHE_TAG], revalidate: 300 },
);

export type PublishedSitePage = { id: string; slug: string; updatedAt: string; content: SitePageContent };

/** Yayındaki tüm sayfalar (sitemap, SEO envanteri). Önbellekli parçalardan okunur. */
export async function listPublishedSitePages(): Promise<PublishedSitePage[]> {
  try {
    const index = await readSitePageIndexCached();
    const live = index.filter((e) => e.status === "yayinda" && e.slug);
    const contents = await Promise.all(live.map((e) => getLiveSitePage(e.id).catch(() => null)));
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

const readSitePageIndexCached = unstable_cache(async () => readSitePageIndexOrThrow(), ["site-pages-index-v1"], {
  tags: [SITE_PAGES_CACHE_TAG],
  revalidate: 300,
});
