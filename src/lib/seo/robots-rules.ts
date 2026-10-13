import { effectiveIndexable } from "./metadata";
import { ALWAYS_DISALLOW, seoPages } from "./registry";
import type { SeoGlobal, SeoPages, SeoRobotsSettings } from "./schema";
import { autoOptimizeRegistryPaths } from "./scope";

/** robots.txt kuralları (SAF). Crawl-delay BİLEREK yoktur (Google yok sayar, Bing'de gereksiz yavaşlatır). */

export type RobotsRuleOut = { userAgent: string | string[]; allow?: string | string[]; disallow?: string | string[] };
export type RobotsOut = { rules: RobotsRuleOut[]; sitemap: string };

export function buildRobots(base: string, settings: SeoRobotsSettings): RobotsOut {
  const disallow = [...new Set<string>([...ALWAYS_DISALLOW, ...settings.extraDisallow])];
  const rules: RobotsRuleOut[] = [{ userAgent: "*", allow: "/", disallow }];
  for (const bot of settings.blockedAiBots) rules.push({ userAgent: bot, disallow: "/" });
  return { rules, sitemap: `${base.replace(/\/+$/, "")}/sitemap.xml` };
}

const asList = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** robots.txt metni (Next'in MetadataRoute.Robots çıktısıyla aynı biçim; önizleme ve test için). */
export function robotsToText(r: RobotsOut): string {
  const blocks = r.rules.map((rule) => {
    const lines: string[] = [];
    for (const ua of asList(rule.userAgent)) lines.push(`User-Agent: ${ua}`);
    for (const a of asList(rule.allow)) lines.push(`Allow: ${a}`);
    for (const d of asList(rule.disallow)) lines.push(`Disallow: ${d}`);
    return lines.join("\n");
  });
  return `${blocks.join("\n\n")}\n\nSitemap: ${r.sitemap}\n`;
}

/**
 * llms.txt: isteğe bağlı site özeti. Varsayılan KAPALI. İçerik admin metnidir (düz metin), yoksa OTOMATİK üretilir:
 * yalnız `canAutoOptimize` izin listesindeki ve (override dahil) indekslenebilir registry sayfaları listelenir.
 * Üyelik/oturum (/kayit, /giris), ofis vitrinleri ve token'lı yüzeyler ASLA girmez.
 */
export function buildLlmsTxt(global: SeoGlobal, settings: SeoRobotsSettings, base: string, pages: SeoPages = {}): string | null {
  if (!settings.llmsTxtEnabled) return null;
  if (settings.llmsTxt.trim()) return `${settings.llmsTxt.trim()}\n`;
  const b = base.replace(/\/+$/, "");
  const allowed = new Set(autoOptimizeRegistryPaths());
  const defs = seoPages().filter((d) => allowed.has(d.path) && effectiveIndexable(d, pages[d.path]));
  const line = (d: (typeof defs)[number]) => {
    const desc = (pages[d.path]?.description ?? d.description ?? "").trim();
    const label = d.path === "/" ? "Ana sayfa" : d.label.replace(/^Araç:\s*/, "");
    return `- [${label}](${d.path === "/" ? `${b}/` : `${b}${d.path}`})${desc ? `: ${desc}` : ""}`;
  };
  const section = (title: string, list: typeof defs) => (list.length > 0 ? [`## ${title}`, ...list.map(line), ""] : []);
  return [
    `# ${global.siteName}`,
    "",
    `> ${global.defaultDescription}`,
    "",
    ...section("Genel sayfalar", defs.filter((d) => d.group === "ana" || d.group === "hesap")),
    ...section("Ücretsiz hesaplama araçları", defs.filter((d) => d.group === "arac")),
    ...section("Yasal metinler", defs.filter((d) => d.group === "yasal")),
  ].join("\n");
}
