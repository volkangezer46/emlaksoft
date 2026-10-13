import { getBaseUrl } from "@/lib/base-url";
import { canonicalUrl } from "@/lib/seo/rules";
import type { SitemapEntry } from "@/lib/seo/sitemap-rules";
import { GUIDE_CATEGORIES, guideCategoryPath, guidePath } from "./defaults";
import { isThinGuide } from "./schema";
import { listPublishedGuides, type PublishedGuide } from "./store";

/**
 * Rehber sitemap girdileri (S5 dikişi: `seo/sitemap-data.ts` bunları ekler).
 * Yalnız YAYINDAKİ ve ince olmayan (indekslenebilir) yazılar girer; `lastModified` = yayın geçmişindeki `at`
 * (yayında listeye `publishedAt` olarak aynı değer yazılır; store.publishGuideContent).
 * Liste ve kategori sayfaları yalnız indekslenebilir yazısı varken girer (yokken noindex'tir: view.ts); lastmod = içindeki
 * en yeni yazının yayın zamanı (gerçek tarih; sahte "bugün" yok).
 */

const indexable = (g: PublishedGuide) => g.entry.status === "yayinda" && Boolean(g.entry.slug) && Boolean(g.entry.publishedAt) && !isThinGuide(g.content);

const publishedIso = (g: PublishedGuide): string | undefined => {
  const t = Date.parse(g.entry.publishedAt ?? "");
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
};

export function guideSitemapEntries(base: string, guides: readonly PublishedGuide[]): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  for (const g of guides) {
    if (!indexable(g)) continue;
    const entry: SitemapEntry = { url: canonicalUrl(base, guidePath(g.entry.slug)), changeFrequency: "monthly", priority: 0.6 };
    const at = publishedIso(g);
    if (at) entry.lastModified = at;
    out.push(entry);
  }
  return out;
}

const newest = (list: readonly PublishedGuide[]): string | undefined =>
  list
    .map(publishedIso)
    .filter((x): x is string => Boolean(x))
    .sort()
    .at(-1);

/** /rehber ve kategori sayfaları: yalnız indekslenebilir yazısı olanlar. */
export function guideHubSitemapEntries(base: string, guides: readonly PublishedGuide[]): SitemapEntry[] {
  const live = guides.filter(indexable);
  if (live.length === 0) return [];
  const withAt = (url: string, list: readonly PublishedGuide[], priority: number): SitemapEntry => {
    const e: SitemapEntry = { url, changeFrequency: "weekly", priority };
    const at = newest(list);
    if (at) e.lastModified = at;
    return e;
  };
  const out = [withAt(canonicalUrl(base, "/rehber"), live, 0.6)];
  for (const k of GUIDE_CATEGORIES) {
    const inCat = live.filter((g) => g.entry.category === k);
    if (inCat.length > 0) out.push(withAt(canonicalUrl(base, guideCategoryPath(k)), inCat, 0.5));
  }
  return out;
}

/** Rehber sitemap girdileri: liste + kategoriler + yazılar (okunamazsa boş: sitemap'in geri kalanı bozulmaz). */
export async function listGuideSitemapEntries(base: string = getBaseUrl()): Promise<SitemapEntry[]> {
  try {
    const guides = await listPublishedGuides();
    return [...guideHubSitemapEntries(base, guides), ...guideSitemapEntries(base, guides)];
  } catch {
    return [];
  }
}
