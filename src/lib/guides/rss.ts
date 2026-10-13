import { canonicalUrl } from "@/lib/seo/rules";
import { GUIDE_CATEGORY_LABEL, guidePath } from "./defaults";
import type { PublishedGuide } from "./store";
import { guideSeoText, GUIDE_HUB_DESCRIPTION, GUIDE_HUB_TITLE } from "./view";

/**
 * /rehber/rss.xml (RSS 2.0, SAF). Her metin XML kaçışlıdır (& < > " '), XML 1.0'da geçersiz denetim karakterleri
 * atılır. Tarih yalnız gerçek yayın zamanıdır (saat okunmaz); en çok 50 yazı, en yeni başta.
 */

const INVALID_XML_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

export function escapeXml(v: string): string {
  return String(v ?? "")
    .replace(INVALID_XML_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const rfc822 = (isoValue: string | null): string | null => {
  const t = isoValue ? Date.parse(isoValue) : NaN;
  return Number.isFinite(t) ? new Date(t).toUTCString() : null;
};

export function renderGuideRss(base: string, guides: readonly PublishedGuide[]): string {
  const items = [...guides]
    .filter((g) => g.entry.status === "yayinda" && g.entry.publishedAt)
    .sort((a, b) => (b.entry.publishedAt ?? "").localeCompare(a.entry.publishedAt ?? ""))
    .slice(0, 50);
  const hub = canonicalUrl(base, "/rehber");
  const lastBuild = rfc822(items[0]?.entry.publishedAt ?? null);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "<channel>",
    `<title>${escapeXml(`${GUIDE_HUB_TITLE} · EmlakSoft`)}</title>`,
    `<link>${escapeXml(hub)}</link>`,
    `<description>${escapeXml(GUIDE_HUB_DESCRIPTION)}</description>`,
    "<language>tr-TR</language>",
    `<atom:link href="${escapeXml(canonicalUrl(base, "/rehber/rss.xml"))}" rel="self" type="application/rss+xml"/>`,
    ...(lastBuild ? [`<lastBuildDate>${lastBuild}</lastBuildDate>`] : []),
  ];
  for (const g of items) {
    const url = canonicalUrl(base, guidePath(g.entry.slug));
    const { description } = guideSeoText(g.content);
    const pub = rfc822(g.entry.publishedAt);
    lines.push(
      "<item>",
      `<title>${escapeXml(g.content.title)}</title>`,
      `<link>${escapeXml(url)}</link>`,
      `<guid isPermaLink="true">${escapeXml(url)}</guid>`,
      ...(description ? [`<description>${escapeXml(description)}</description>`] : []),
      `<category>${escapeXml(GUIDE_CATEGORY_LABEL[g.entry.category])}</category>`,
      ...(pub ? [`<pubDate>${pub}</pubDate>`] : []),
      "</item>",
    );
  }
  lines.push("</channel>", "</rss>");
  return `${lines.join("\n")}\n`;
}
