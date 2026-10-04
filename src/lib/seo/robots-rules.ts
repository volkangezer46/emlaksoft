import { ALWAYS_DISALLOW } from "./registry";
import type { SeoGlobal, SeoRobotsSettings } from "./schema";

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
 * llms.txt: isteğe bağlı site özeti. Varsayılan KAPALI. İçerik admin metnidir (düz metin),
 * yoksa ayarlardaki site adı/açıklamasından üretilen güvenli özet.
 */
export function buildLlmsTxt(global: SeoGlobal, settings: SeoRobotsSettings, base: string): string | null {
  if (!settings.llmsTxtEnabled) return null;
  if (settings.llmsTxt.trim()) return `${settings.llmsTxt.trim()}\n`;
  const b = base.replace(/\/+$/, "");
  return [
    `# ${global.siteName}`,
    "",
    `> ${global.defaultDescription}`,
    "",
    "## Genel sayfalar",
    `- [Ana sayfa](${b}/)`,
    `- [Fiyatlar](${b}/fiyatlar)`,
    `- [Ücretsiz hesaplama araçları](${b}/araclar)`,
    `- [Demo talebi](${b}/demo)`,
    "",
  ].join("\n");
}
