import { getBaseUrl } from "@/lib/base-url";
import { canonicalUrl } from "@/lib/seo/rules";
import type { SitemapEntry } from "@/lib/seo/sitemap-rules";
import { guidePath } from "./defaults";
import { isThinGuide } from "./schema";
import { listPublishedGuides, type PublishedGuide } from "./store";

/**
 * Rehber sitemap girdileri. Sitemap'e kaydı (sitemap-data.ts) S5 dikişindedir; bu dosya yalnız girdileri üretir.
 * Yalnız YAYINDAKİ ve ince olmayan (indekslenebilir) yazılar girer; `lastModified` = yayın geçmişindeki `at`
 * (yayında listeye `publishedAt` olarak aynı değer yazılır; store.publishGuideContent).
 */

export function guideSitemapEntries(base: string, guides: readonly PublishedGuide[]): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  for (const g of guides) {
    if (g.entry.status !== "yayinda" || !g.entry.slug || !g.entry.publishedAt) continue;
    if (isThinGuide(g.content)) continue;
    const entry: SitemapEntry = { url: canonicalUrl(base, guidePath(g.entry.slug)), changeFrequency: "monthly", priority: 0.6 };
    const t = Date.parse(g.entry.publishedAt);
    if (Number.isFinite(t)) entry.lastModified = new Date(t).toISOString();
    out.push(entry);
  }
  return out;
}

/** Yayındaki yazıların sitemap girdileri (okunamazsa boş: sitemap'in geri kalanı bozulmaz). */
export async function listGuideSitemapEntries(base: string = getBaseUrl()): Promise<SitemapEntry[]> {
  try {
    return guideSitemapEntries(base, await listPublishedGuides());
  } catch {
    return [];
  }
}
