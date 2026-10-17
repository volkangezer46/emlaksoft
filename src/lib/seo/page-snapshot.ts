import type { DeepFacts, Finding, PageFacts } from "./audit-rules";
import { extractJsonLdBlocks } from "./jsonld";
import { followableUrl, urlKey } from "./discovery";
import { validateStructuredData } from "./structured-data";

/**
 * SAYFA ANLIK GÖRÜNTÜSÜ (SAF): robotun taradığı her sayfanın puanlamada kullanılan ölçümleri. Robot koşusu sonunda
 * `seo.audit.pages` anahtarına yazılır (sistem kaydı; `seo.audit.*`). Ağ/DB yok; testlidir.
 */

export type PageSnapshot = {
  url: string;
  status: number;
  inSitemap: boolean;
  noindex: boolean;
  title: string | null;
  description: string | null;
  canonical: string | null;
  h1: string | null;
  h1Count: number;
  headingSkip: string | null;
  words: number;
  imgs: number;
  imgsNoAlt: number;
  /** Sayfadan çıkan izlenebilir iç bağlantı sayısı (tekil hedef). */
  linksOut: number;
  /** Taranan diğer sayfalardan bu sayfaya gelen bağlantı veren sayfa sayısı. */
  linksIn: number;
  ldTypes: string[];
  ldErrors: number;
  ldWarnings: number;
  ldParseErrors: number;
  bytes: number;
  ttfbMs: number | null;
  mixed: number;
  dupTitle: boolean;
  dupDescription: boolean;
  /** Robots.txt bu sayfayı engelliyor. */
  robotsBlocked: boolean;
};

export type SnapshotExtras = { h1Text: string | null; imgTotal: number; ldTypes: string[]; ldWarnings: number };

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** HTML'den ek ölçümler: ilk h1 metni, görsel sayısı, JSON-LD türleri ve önerilen alan uyarı sayısı. */
export function extractSnapshotExtras(html: string): SnapshotExtras {
  const clean = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ");
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(clean);
  const imgTotal = (clean.match(/<img\b/gi) ?? []).length;
  const { blocks } = extractJsonLdBlocks(html);
  const types = new Set<string>();
  let ldWarnings = 0;
  for (const b of blocks) {
    const r = validateStructuredData(b);
    for (const t of r.types) types.add(t);
    ldWarnings += r.warnings.length;
  }
  const h1Text = h1 ? decode(h1[1] ?? "").slice(0, 200) : null;
  return { h1Text: h1Text || null, imgTotal, ldTypes: [...types].slice(0, 20), ldWarnings };
}

const clip = (v: string | null, n: number) => (v == null ? null : v.length > n ? v.slice(0, n) : v);

export function buildSnapshots(input: {
  pages: readonly { facts: PageFacts; deep: DeepFacts | null; extras: SnapshotExtras | null }[];
  origin: string;
  sitemapKeys: ReadonlySet<string>;
  inbound: ReadonlyMap<string, ReadonlySet<string>>;
  findings: readonly Finding[];
}): PageSnapshot[] {
  const dupT = new Set(input.findings.filter((f) => f.code === "duplicate-title").map((f) => urlKey(f.url)));
  const dupD = new Set(input.findings.filter((f) => f.code === "duplicate-description").map((f) => urlKey(f.url)));
  const blocked = new Set(input.findings.filter((f) => f.code === "sitemap-disallowed").map((f) => urlKey(f.url)));
  return input.pages.map(({ facts: f, deep, extras }) => {
    const key = urlKey(f.url);
    const out = new Set<string>();
    for (const href of f.links) {
      const t = followableUrl(href, f.url, input.origin);
      if (t && urlKey(t) !== key) out.add(urlKey(t));
    }
    const inbound = [...(input.inbound.get(key) ?? [])].filter((src) => urlKey(src) !== key).length;
    return {
      url: f.url,
      status: f.status,
      inSitemap: input.sitemapKeys.has(key),
      noindex: f.noindex,
      title: clip(f.title, 300),
      description: clip(f.description, 400),
      canonical: clip(f.canonical, 400),
      h1: extras?.h1Text ?? null,
      h1Count: f.h1Count,
      headingSkip: deep?.headingSkip ?? null,
      words: deep?.wordCount ?? 0,
      imgs: extras?.imgTotal ?? 0,
      imgsNoAlt: deep?.imgsMissingAlt ?? 0,
      linksOut: out.size,
      linksIn: inbound,
      ldTypes: extras?.ldTypes ?? [],
      ldErrors: f.jsonLdErrors.length,
      ldWarnings: extras?.ldWarnings ?? 0,
      ldParseErrors: f.jsonLdParseErrors,
      bytes: deep?.rawBytes ?? 0,
      ttfbMs: deep?.ttfbMs == null ? null : Math.round(deep.ttfbMs),
      mixed: deep?.mixedContent ?? 0,
      dupTitle: dupT.has(key),
      dupDescription: dupD.has(key),
      robotsBlocked: blocked.has(key),
    };
  });
}
