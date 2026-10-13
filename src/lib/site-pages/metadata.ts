import type { ExtraMetadata } from "@/lib/seo/metadata";
import { canonicalUrl } from "@/lib/seo/rules";
import type { SitemapEntry } from "@/lib/seo/sitemap-rules";
import { suggestSeo, type SitePageContent } from "./schema-core";

/**
 * Özel sayfa SEO çevirileri (SAF). Metadata `buildMetadata(path, extra)` ile üretilir: başlık şablonu (getSeoSettings)
 * orada uygulanır; /admin/seo'da aynı yol için override varsa o kazanır.
 */

/** Sayfa seo alanından metadata girdisi: canonical = site tabanı + yol; index=false ise noindex. Boş başlık/açıklama ilk girişten önerilir. */
export function sitePageExtraMetadata(base: string, slug: string, content: SitePageContent): ExtraMetadata {
  const s = content.seo;
  const suggested = suggestSeo(content);
  const title = s.title || suggested.title || content.title;
  const description = s.description || suggested.description || undefined;
  return {
    title,
    description,
    ...(s.ogTitle ? { ogTitle: s.ogTitle } : {}),
    ...(s.ogDescription ? { ogDescription: s.ogDescription } : {}),
    ...(s.ogImage ? { ogImage: s.ogImage } : {}),
    canonical: canonicalUrl(base, `/${slug}`),
    ...(s.index ? {} : { noindex: true }),
  };
}

/** Sayfadaki görünen SSS (FAQPage JSON-LD bu listeden üretilir). */
export function sitePageFaq(content: SitePageContent): Array<{ q: string; a: string }> {
  return content.blocks.flatMap((b) => (b.type === "faq" ? b.items : []));
}

/** Sitemap girdileri: yalnız yayında + index + inSitemap olan sayfalar. lastModified gerçek yayın zamanıdır. */
export function sitePageSitemapEntries(base: string, pages: ReadonlyArray<{ slug: string; updatedAt: string; content: SitePageContent }>): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  for (const p of pages) {
    if (!p.content.seo.index || !p.content.seo.inSitemap) continue;
    const entry: SitemapEntry = { url: canonicalUrl(base, `/${p.slug}`), changeFrequency: "monthly", priority: 0.6 };
    const t = Date.parse(p.updatedAt);
    if (Number.isFinite(t)) entry.lastModified = new Date(t).toISOString();
    out.push(entry);
  }
  return out;
}
