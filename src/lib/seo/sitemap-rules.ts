import { effectiveIndexable } from "./metadata";
import { NEVER_INDEX_PREFIXES, seoPages } from "./registry";
import { canonicalUrl } from "./rules";
import type { ChangeFreq, SeoPages, SeoSitemapSettings } from "./schema";

/**
 * Sitemap kuralları (SAF). Sitemap'e girebilecek her URL `isSitemapSafePath` süzgecinden geçer:
 * token'lı portallar, oturumlu alanlar, ödeme/imza/anket/randevu, sunum/paylaş, giriş, sorgu dizesi
 * ve favoriler ASLA girmez (sözleşme testi: seo-contract.test.ts).
 */

export type SitemapEntry = {
  url: string;
  /** ISO. Yalnız GERÇEK bir güncelleme zamanı varsa doldurulur; yoksa alan hiç yazılmaz. */
  lastModified?: string;
  changeFrequency?: ChangeFreq;
  priority?: number;
};

export const SITEMAP_PROTOCOL_MAX_URLS = 50000;
export const SITEMAP_PROTOCOL_MAX_BYTES = 50 * 1024 * 1024;

export function isSitemapSafePath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  if (/[?#]/.test(path)) return false;
  if (path.includes("/favoriler")) return false;
  for (const prefix of NEVER_INDEX_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return false;
  }
  return true;
}

function pathOf(url: string): string | null {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return null;
  }
}

/** Son güvenlik süzgeci: güvensiz yolları ve yinelenen adresleri atar. */
export function filterSafeEntries(entries: readonly SitemapEntry[]): SitemapEntry[] {
  const seen = new Set<string>();
  const out: SitemapEntry[] = [];
  for (const e of entries) {
    const p = pathOf(e.url);
    if (!p || !isSitemapSafePath(p)) continue;
    if (seen.has(e.url)) continue;
    seen.add(e.url);
    out.push(e);
  }
  return out;
}

/** Geçerli ISO zamanlarının en yenisi; hiçbiri geçerli değilse undefined (sahte "bugün" ASLA üretilmez). */
export function latestIso(...values: ReadonlyArray<string | null | undefined>): string | undefined {
  let best: number | null = null;
  for (const v of values) {
    if (typeof v !== "string" || !v) continue;
    const t = Date.parse(v);
    if (Number.isFinite(t) && (best === null || t > best)) best = t;
  }
  return best === null ? undefined : new Date(best).toISOString();
}

/**
 * Versioned-config geçmişinin (`<prefix>.history`, en yeni başta) son canlı girdisinin `at` değeri.
 * Geçmiş yoksa/bozuksa undefined: o yayın yüzeyi için lastmod bilinmiyor demektir.
 */
export function historyHeadAt(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr) || arr.length === 0) return undefined;
    const at = (arr[0] as { at?: unknown } | null)?.at;
    return typeof at === "string" ? latestIso(at) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Statik sayfa ve araç girdileri (ayarlar + sayfa override'ları).
 * lastmod = en yeni (yayın yüzeyinin son canlı geçmiş girdisi `publishedAt[yol]`, sayfa SEO override'ının `updatedAt`'i);
 * ikisi de yoksa lastmod YAZILMAZ.
 */
export function staticSitemapEntries(
  base: string,
  pages: SeoPages,
  settings: SeoSitemapSettings,
  publishedAt: Readonly<Record<string, string | undefined>> = {},
): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  for (const def of seoPages()) {
    const isTool = def.group === "arac";
    if (isTool ? !settings.tools : !settings.staticPages) continue;
    const ov = pages[def.path];
    const indexable = effectiveIndexable(def, ov);
    const include = ov?.sitemapInclude ?? def.sitemap.include;
    if (!indexable || !include) continue;
    if (!isSitemapSafePath(def.path)) continue;
    const entry: SitemapEntry = {
      url: canonicalUrl(base, ov?.canonical && ov.canonical.startsWith("/") ? ov.canonical : def.path),
      changeFrequency: ov?.changeFreq ?? def.sitemap.freq,
      priority: ov?.sitemapPriority ?? def.sitemap.priority,
    };
    const lastmod = latestIso(publishedAt[def.path], ov?.updatedAt);
    if (lastmod) entry.lastModified = lastmod;
    out.push(entry);
  }
  return out;
}

/** Vitrin ofisi sitemap'e girer mi? Varsayılan: yalnız opt-in listesindekiler. */
export function tenantInSitemap(settings: SeoSitemapSettings, slug: string): boolean {
  if (!settings.vitrinOffices && !settings.vitrinListings) return false;
  return !settings.onlyOptIn || settings.optInTenantSlugs.includes(slug);
}

export function chunkEntries<T>(entries: readonly T[], max: number): T[][] {
  const size = Math.max(1, Math.min(Math.floor(max), SITEMAP_PROTOCOL_MAX_URLS));
  const out: T[][] = [];
  for (let i = 0; i < entries.length; i += size) out.push(entries.slice(i, i + size));
  return out.length === 0 ? [[]] : out;
}

export function xmlEscape(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function renderUrlset(entries: readonly SitemapEntry[]): string {
  const rows = entries.map((e) => {
    const parts = [`<loc>${xmlEscape(e.url)}</loc>`];
    if (e.lastModified) parts.push(`<lastmod>${xmlEscape(e.lastModified)}</lastmod>`);
    if (e.changeFrequency) parts.push(`<changefreq>${e.changeFrequency}</changefreq>`);
    if (e.priority !== undefined) parts.push(`<priority>${e.priority.toFixed(1)}</priority>`);
    return `<url>${parts.join("")}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows.join("")}</urlset>\n`;
}

export function renderSitemapIndex(items: readonly { url: string; lastModified?: string }[]): string {
  const rows = items.map(
    (i) => `<sitemap><loc>${xmlEscape(i.url)}</loc>${i.lastModified ? `<lastmod>${xmlEscape(i.lastModified)}</lastmod>` : ""}</sitemap>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows.join("")}</sitemapindex>\n`;
}

/** XML'den <loc> adreslerini çıkarır (robot ve test için). */
export function parseLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>([\s\S]*?)<\/loc>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    out.push((m[1] ?? "").trim().replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
  }
  return out;
}
