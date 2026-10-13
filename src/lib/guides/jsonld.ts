import { canonicalUrl } from "@/lib/seo/rules";
import { faqLd, type LdNode } from "@/lib/seo/jsonld";
import { plainInline } from "@/lib/rich-text/parse-inline";
import { GUIDE_CATEGORY_LABEL, guideCategoryPath, guidePath, type GuideContent, type GuideIndexEntry } from "./defaults";
import { guideWordCount } from "./schema";
import { guideSeoText, GUIDE_HUB_TITLE } from "./view";

/**
 * Rehber JSON-LD (SAF). Çıktı sayfada `serializeJsonLd` ile basılır. Yazar ve yayıncı kurumdur ("EmlakSoft"); kişi adı
 * uydurulmaz. Tarihler gerçek yayın geçmişinden gelir (datePublished = ilk yayın, dateModified = son yayın).
 * AggregateRating/Review ASLA üretilmez.
 */

export const GUIDE_AUTHOR_NAME = "EmlakSoft";

export type GuideLdInput = { base: string; entry: Pick<GuideIndexEntry, "slug" | "category" | "publishedAt" | "firstPublishedAt">; content: GuideContent };

export function guideArticleLd({ base, entry, content }: GuideLdInput): LdNode {
  const url = canonicalUrl(base, guidePath(entry.slug));
  const org = { "@type": "Organization", name: GUIDE_AUTHOR_NAME, url: canonicalUrl(base, "/") };
  const { description } = guideSeoText(content);
  const published = entry.firstPublishedAt ?? entry.publishedAt ?? "";
  return {
    "@type": "Article",
    headline: content.title.slice(0, 110),
    ...(description ? { description } : {}),
    datePublished: published,
    dateModified: entry.publishedAt ?? published,
    author: org,
    publisher: org,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
    inLanguage: "tr-TR",
    articleSection: GUIDE_CATEGORY_LABEL[entry.category],
    wordCount: guideWordCount(content),
  };
}

export function guideBreadcrumbLd(base: string, items: ReadonlyArray<{ name: string; path: string }>): LdNode {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: canonicalUrl(base, it.path) })),
  };
}

/** Yazı sayfasının kırıntıları (görünen gezinme ile aynı). */
export function guideCrumbs(entry: Pick<GuideIndexEntry, "slug" | "category">, title: string) {
  return [
    { name: "Ana sayfa", path: "/" },
    { name: GUIDE_HUB_TITLE, path: "/rehber" },
    { name: GUIDE_CATEGORY_LABEL[entry.category], path: guideCategoryPath(entry.category) },
    { name: title, path: guidePath(entry.slug) },
  ];
}

/** Yazı sayfası @graph: Article + BreadcrumbList (+ gövdede SSS varsa FAQPage). */
export function guidePageJsonLd(input: GuideLdInput): LdNode {
  const faq = faqLd(input.content.body.flatMap((b) => (b.type === "faq" ? b.items.map((it) => ({ q: it.q, a: plainInline(it.a) })) : [])));
  return {
    "@context": "https://schema.org",
    "@graph": [guideArticleLd(input), guideBreadcrumbLd(input.base, guideCrumbs(input.entry, input.content.title)), ...(faq ? [faq] : [])],
  };
}
