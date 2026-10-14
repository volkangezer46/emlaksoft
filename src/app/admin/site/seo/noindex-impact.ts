import type { AiBotId, SeoRobotsSettings, SeoSitemapSettings } from "@/lib/seo/schema";

/**
 * Kazara noindex koruması (SAF): kaydedilmek üzere olan değişikliğin kaç URL'yi arama dışına çıkaracağını
 * GÜNCEL sitemap önizlemesinden hesaplar. Sayı > 0 ise yönetim ekranı kaydetmeden önce onay ister.
 */

export type SeoImpact = { count: number; details: string[] };

export const NO_IMPACT: SeoImpact = { count: 0, details: [] };

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Sayfa override'ı: noindex ya da sitemap dışı seçimi, sayfa şu an sitemap'te/indekslenebilirse 1 URL çıkarır. */
export function pageImpact(input: {
  path: string;
  currentlyIndexable: boolean;
  currentlyInSitemap: boolean;
  nextIndexable: boolean;
  nextInSitemap: boolean;
}): SeoImpact {
  const details: string[] = [];
  if (input.currentlyIndexable && !input.nextIndexable) details.push(`${input.path} noindex olur (arama sonuçlarından düşer).`);
  if (input.currentlyInSitemap && !input.nextInSitemap) details.push(`${input.path} sitemap'ten çıkar.`);
  return details.length > 0 ? { count: 1, details } : NO_IMPACT;
}

const GROUPS: { key: keyof Pick<SeoSitemapSettings, "staticPages" | "tools" | "vitrinOffices" | "vitrinListings" | "advisors">; label: string; test: (p: string) => boolean }[] = [
  { key: "tools", label: "Ücretsiz araçlar", test: (p) => p === "/araclar" || p.startsWith("/araclar/") },
  { key: "vitrinOffices", label: "Vitrin ofis sayfaları", test: (p) => /^\/vitrin\/[^/]+(\/degerleme)?$/.test(p) },
  { key: "vitrinListings", label: "Vitrin ilanları", test: (p) => /^\/vitrin\/[^/]+\/[^/]+$/.test(p) && !p.endsWith("/degerleme") },
  { key: "advisors", label: "Danışman kartvizitleri", test: (p) => p.startsWith("/danisman/") },
  { key: "staticPages", label: "Statik sayfalar", test: (p) => !p.startsWith("/araclar") && !p.startsWith("/vitrin/") && !p.startsWith("/danisman/") },
];

/** Sitemap kapsamı daralması: kapatılan her grup + opt-in'e geçişte onaysız ofislerin vitrin adresleri. */
export function sitemapImpact(urls: readonly string[], cur: SeoSitemapSettings, next: SeoSitemapSettings, optInSlugs: readonly string[]): SeoImpact {
  const paths = urls.map(pathOf);
  const removed = new Set<string>();
  const details: string[] = [];
  for (const g of GROUPS) {
    if (cur[g.key] && !next[g.key]) {
      const hit = paths.filter(g.test);
      hit.forEach((p) => removed.add(p));
      details.push(`${g.label} kapanıyor: ${hit.length} adres.`);
    }
  }
  if (!cur.onlyOptIn && next.onlyOptIn) {
    const allowed = new Set(optInSlugs);
    const hit = paths.filter((p) => {
      const m = /^\/vitrin\/([^/]+)/.exec(p);
      return m ? !allowed.has(m[1]!) : false;
    });
    hit.forEach((p) => removed.add(p));
    // Ofis onayı (tenants.vitrin_seo_optin) burada bilinmez; yalnız yedek listeye göre sayılır = üst sınır.
    if (hit.length > 0) details.push(`Yalnız onaylı ofisler: onaysız ofislerin en çok ${hit.length} vitrin adresi çıkar (danışman kartları ayrıca düşebilir).`);
  }
  return { count: removed.size, details };
}

/** robots.txt Disallow deseni (önek; `*` joker, sonda `$` çapa). */
export function robotsPatternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}

/** robots daralması: yeni eklenen Disallow yollarına düşen sitemap adresleri + yeni engellenen yapay zekâ tarayıcıları. */
export function robotsImpact(urls: readonly string[], cur: SeoRobotsSettings, next: { extraDisallow: string[]; blockedAiBots: AiBotId[] | string[] }): SeoImpact {
  const added = next.extraDisallow.filter((d) => !cur.extraDisallow.includes(d));
  const paths = urls.map(pathOf);
  const hit = added.length > 0 ? paths.filter((p) => added.some((d) => robotsPatternMatches(d, p))) : [];
  const details: string[] = [];
  if (added.length > 0) details.push(`Yeni Disallow: ${added.join(", ")} (${hit.length} sitemap adresi taranamaz olur).`);
  const newBots = (next.blockedAiBots as string[]).filter((b) => !(cur.blockedAiBots as string[]).includes(b));
  if (newBots.length > 0) details.push(`${newBots.length} yapay zekâ tarayıcısı tüm siteden engellenir: ${newBots.join(", ")}.`);
  return { count: hit.length, details: hit.length > 0 || newBots.length > 0 ? details : [] };
}
